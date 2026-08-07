import crypto from 'crypto';
import { getCache } from './cache.service.js';
import { config, CAPTCHA_CONFIG } from '../config.js';
import { generatePuzzleImage } from './puzzle-image.service.js';
import { encodePngDataUri } from './png-encoder.js';
import { evaluateSolution } from './captcha-verify.js';
import type { TrailSample, CaptchaInputMode } from './captcha-verify.js';

const FAIL_PREFIX = 'captcha:fails:';
const CHALLENGE_PREFIX = 'captcha:challenge:';
const PASS_PREFIX = 'captcha:pass:';

interface ChallengeState {
  pieceX: number;
  pieceY: number;
  tenantId: string;
  identity: string;
  attemptsRemaining: number;
  expiresAt: number;
}

/** Same identity shape as loginRateLimit's keyFn (server/routes/auth/login.ts) — ip+tenant+username, lowercased. */
export function loginIdentity(ip: string, tenantId: string, username: string): string {
  return `${ip || 'unknown'}:${tenantId || 'default'}:${(username || '').toLowerCase()}`;
}

/**
 * Called from the failed-password branch in login.ts. Errors are left to
 * propagate — callers should fire-and-forget with a `.catch(logger.warn)`,
 * matching the existing recordLoginEvent() convention in login.ts, so a cache
 * hiccup never blocks a login response.
 */
export async function recordLoginFailure(identity: string): Promise<number> {
  const cache = await getCache();
  return cache.incr(`${FAIL_PREFIX}${identity}`, CAPTCHA_CONFIG.failCounterTtlSec);
}

/** Called on successful password check, mirroring the failedLoginAttempts=0 DB reset. */
export async function clearLoginFailures(identity: string): Promise<void> {
  const cache = await getCache();
  await cache.del(`${FAIL_PREFIX}${identity}`);
}

/**
 * Whether this identity currently has enough consecutive password failures to
 * require a captcha. Does not consult CAPTCHA_MODE — callers (captcha-guard.ts)
 * decide how to act on 'shadow' vs 'enforce'.
 */
export async function isCaptchaRequired(identity: string): Promise<boolean> {
  const cache = await getCache();
  const raw = await cache.get(`${FAIL_PREFIX}${identity}`);
  const count = raw ? parseInt(raw, 10) : 0;
  return count >= CAPTCHA_CONFIG.triggerThreshold;
}

export interface IssuedChallenge {
  challenge_id: string;
  bg_image: string;
  piece_image: string;
  piece_y: number;
  canvas_width: number;
  canvas_height: number;
  piece_size: number;
  /** Test-only escape hatch so integration tests can solve a challenge deterministically without real drag input. Never present outside NODE_ENV=test. */
  piece_x?: number;
}

export async function issueChallenge(identity: string, tenantId: string): Promise<IssuedChallenge> {
  const { bgBuffer, pieceBuffer, pieceWidth, pieceHeight, pieceX, pieceY } = generatePuzzleImage({
    canvasWidth: CAPTCHA_CONFIG.canvasWidth,
    canvasHeight: CAPTCHA_CONFIG.canvasHeight,
    pieceSize: CAPTCHA_CONFIG.pieceSize,
  });

  const [bgImage, pieceImage] = await Promise.all([
    encodePngDataUri(bgBuffer, CAPTCHA_CONFIG.canvasWidth, CAPTCHA_CONFIG.canvasHeight),
    encodePngDataUri(pieceBuffer, pieceWidth, pieceHeight),
  ]);

  const challengeId = crypto.randomBytes(16).toString('hex');
  const state: ChallengeState = {
    pieceX,
    pieceY,
    tenantId,
    identity,
    attemptsRemaining: CAPTCHA_CONFIG.maxVerifyAttempts,
    expiresAt: Date.now() + CAPTCHA_CONFIG.challengeTtlSec * 1000,
  };

  const cache = await getCache();
  await cache.set(`${CHALLENGE_PREFIX}${challengeId}`, JSON.stringify(state), CAPTCHA_CONFIG.challengeTtlSec);

  return {
    challenge_id: challengeId,
    bg_image: bgImage,
    piece_image: pieceImage,
    piece_y: pieceY,
    canvas_width: CAPTCHA_CONFIG.canvasWidth,
    canvas_height: CAPTCHA_CONFIG.canvasHeight,
    piece_size: CAPTCHA_CONFIG.pieceSize,
    ...(config.NODE_ENV === 'test' ? { piece_x: pieceX } : {}),
  };
}

export type VerifyOutcome =
  | { ok: true; captchaPass: string; expiresIn: number }
  | { ok: false; code: 'CAPTCHA_INVALID'; attemptsRemaining: number }
  | { ok: false; code: 'CAPTCHA_EXPIRED' };

export async function verifyChallenge(
  challengeId: string,
  submittedX: number,
  trail: TrailSample[],
  inputMode: CaptchaInputMode
): Promise<VerifyOutcome> {
  const cache = await getCache();
  const key = `${CHALLENGE_PREFIX}${challengeId}`;
  const raw = await cache.get(key);
  if (!raw) return { ok: false, code: 'CAPTCHA_EXPIRED' };

  const state: ChallengeState = JSON.parse(raw);
  if (Date.now() > state.expiresAt || state.attemptsRemaining <= 0) {
    await cache.del(key);
    return { ok: false, code: 'CAPTCHA_EXPIRED' };
  }

  const result = evaluateSolution({
    submittedX,
    pieceX: state.pieceX,
    tolerancePx: CAPTCHA_CONFIG.tolerancePx,
    trail,
    inputMode,
    travelRangePx: CAPTCHA_CONFIG.canvasWidth - CAPTCHA_CONFIG.pieceSize,
  });

  if (!result.pass) {
    state.attemptsRemaining -= 1;
    if (state.attemptsRemaining <= 0) {
      await cache.del(key);
      return { ok: false, code: 'CAPTCHA_EXPIRED' };
    }
    // expiresAt is the source of truth for expiry, not the cache TTL — re-set with
    // whatever time is actually left so a failed attempt doesn't extend the puzzle's life.
    const remainingTtl = Math.max(1, Math.ceil((state.expiresAt - Date.now()) / 1000));
    await cache.set(key, JSON.stringify(state), remainingTtl);
    return { ok: false, code: 'CAPTCHA_INVALID', attemptsRemaining: state.attemptsRemaining };
  }

  // One-time-use: burn the challenge immediately on success so it can't be replayed.
  await cache.del(key);

  const passToken = crypto.randomBytes(32).toString('hex');
  await cache.set(
    `${PASS_PREFIX}${passToken}`,
    JSON.stringify({ identity: state.identity, tenantId: state.tenantId }),
    CAPTCHA_CONFIG.passTokenTtlSec
  );

  return { ok: true, captchaPass: passToken, expiresIn: CAPTCHA_CONFIG.passTokenTtlSec };
}

/**
 * Atomically consumes a captcha_pass token and confirms it was issued for this
 * exact identity (ip+tenant+username) — a token solved for one identity must
 * not authorize a login attempt for a different one. Returns false for a
 * missing/already-used/mismatched token. Throws on cache errors so the caller
 * (captcha-guard.ts) can decide to fail open, matching rateLimit()'s stance
 * that an unreachable cache backend must not take down login.
 */
export async function consumeCaptchaPass(token: string, identity: string): Promise<boolean> {
  const cache = await getCache();
  const raw = await cache.getdel(`${PASS_PREFIX}${token}`);
  if (!raw) return false;
  const parsed = JSON.parse(raw) as { identity: string; tenantId: string };
  return parsed.identity === identity;
}
