import { describe, it, expect, beforeEach } from 'vitest';
import { resetCacheForTests } from '../server/services/cache.service.js';
import {
  loginIdentity,
  recordLoginFailure,
  clearLoginFailures,
  isCaptchaRequired,
  issueChallenge,
  verifyChallenge,
  consumeCaptchaPass,
} from '../server/services/captcha.service.js';
import type { TrailSample } from '../server/services/captcha-verify.js';

function humanTrail(targetX: number, samples = 10): TrailSample[] {
  const trail: TrailSample[] = [];
  for (let i = 0; i < samples; i++) {
    const frac = i / (samples - 1);
    const eased = 1 - (1 - frac) ** 2;
    trail.push({ x: Math.round(eased * targetX), y: i % 2 === 0 ? 1 : -1, t: i * 30 });
  }
  trail[trail.length - 1].x = targetX;
  return trail;
}

describe('captcha.service', () => {
  beforeEach(() => {
    // Each test gets a fresh in-process cache — this module-level singleton
    // otherwise leaks challenge/fail-counter state across tests.
    resetCacheForTests();
  });

  describe('adaptive failure counter', () => {
    it('is not required below the trigger threshold, and required at/above it', async () => {
      const identity = loginIdentity('127.0.0.1', 'default', 'alice');

      expect(await isCaptchaRequired(identity)).toBe(false);
      await recordLoginFailure(identity);
      expect(await isCaptchaRequired(identity)).toBe(false); // 1 failure, threshold is 2

      await recordLoginFailure(identity);
      expect(await isCaptchaRequired(identity)).toBe(true); // 2 failures, threshold reached
    });

    it('clears on success, mirroring the failedLoginAttempts=0 DB reset', async () => {
      const identity = loginIdentity('127.0.0.1', 'default', 'bob');
      await recordLoginFailure(identity);
      await recordLoginFailure(identity);
      expect(await isCaptchaRequired(identity)).toBe(true);

      await clearLoginFailures(identity);
      expect(await isCaptchaRequired(identity)).toBe(false);
    });

    it('keys failures independently per ip+tenant+username identity', async () => {
      const a = loginIdentity('1.1.1.1', 'default', 'carol');
      const b = loginIdentity('2.2.2.2', 'default', 'carol');
      await recordLoginFailure(a);
      await recordLoginFailure(a);
      expect(await isCaptchaRequired(a)).toBe(true);
      expect(await isCaptchaRequired(b)).toBe(false);
    });
  });

  describe('challenge issuance and solving', () => {
    it('issues a challenge with a solvable secret (test-only piece_x) and valid PNG data URIs', async () => {
      const identity = loginIdentity('127.0.0.1', 'default', 'dave');
      const challenge = await issueChallenge(identity, 'default');

      expect(challenge.challenge_id).toMatch(/^[0-9a-f]{32}$/);
      expect(challenge.bg_image.startsWith('data:image/png;base64,')).toBe(true);
      expect(challenge.piece_image.startsWith('data:image/png;base64,')).toBe(true);
      expect(typeof challenge.piece_y).toBe('number');
      // NODE_ENV=test (set by vitest) surfaces this escape hatch so the test can solve deterministically.
      expect(typeof challenge.piece_x).toBe('number');
    });

    it('accepts a correct solution and returns a one-time captcha_pass', async () => {
      const identity = loginIdentity('127.0.0.1', 'default', 'erin');
      const challenge = await issueChallenge(identity, 'default');
      const pieceX = challenge.piece_x!;

      const outcome = await verifyChallenge(challenge.challenge_id, pieceX, humanTrail(pieceX), 'pointer');
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.captchaPass).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('rejects a wrong offset and decrements attempts remaining', async () => {
      const identity = loginIdentity('127.0.0.1', 'default', 'frank');
      const challenge = await issueChallenge(identity, 'default');
      const wrongX = (challenge.piece_x! + 50) % 276;

      const outcome = await verifyChallenge(challenge.challenge_id, wrongX, humanTrail(wrongX), 'pointer');
      expect(outcome.ok).toBe(false);
      if (!outcome.ok && outcome.code === 'CAPTCHA_INVALID') {
        expect(outcome.attemptsRemaining).toBe(2); // maxVerifyAttempts(3) - 1
      } else {
        throw new Error('expected CAPTCHA_INVALID');
      }
    });

    it('burns the challenge after exhausting all verify attempts', async () => {
      const identity = loginIdentity('127.0.0.1', 'default', 'gina');
      const challenge = await issueChallenge(identity, 'default');
      const wrongX = (challenge.piece_x! + 50) % 276;

      await verifyChallenge(challenge.challenge_id, wrongX, humanTrail(wrongX), 'pointer'); // 1
      await verifyChallenge(challenge.challenge_id, wrongX, humanTrail(wrongX), 'pointer'); // 2
      const third = await verifyChallenge(challenge.challenge_id, wrongX, humanTrail(wrongX), 'pointer'); // 3 -> burned
      expect(third.ok).toBe(false);
      if (!third.ok) expect(third.code).toBe('CAPTCHA_EXPIRED');

      // Even the correct answer no longer works — challenge is gone.
      const afterBurn = await verifyChallenge(challenge.challenge_id, challenge.piece_x!, humanTrail(challenge.piece_x!), 'pointer');
      expect(afterBurn.ok).toBe(false);
      if (!afterBurn.ok) expect(afterBurn.code).toBe('CAPTCHA_EXPIRED');
    });

    it('returns CAPTCHA_EXPIRED for an unknown challenge id', async () => {
      const outcome = await verifyChallenge('does-not-exist', 100, humanTrail(100), 'pointer');
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe('CAPTCHA_EXPIRED');
    });

    it('is one-time-use: a solved captcha_pass cannot be consumed twice (replay protection)', async () => {
      const identity = loginIdentity('127.0.0.1', 'default', 'holly');
      const challenge = await issueChallenge(identity, 'default');
      const outcome = await verifyChallenge(challenge.challenge_id, challenge.piece_x!, humanTrail(challenge.piece_x!), 'pointer');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('expected solve to succeed');

      expect(await consumeCaptchaPass(outcome.captchaPass, identity)).toBe(true);
      expect(await consumeCaptchaPass(outcome.captchaPass, identity)).toBe(false); // replay rejected
    });

    it('rejects a captcha_pass consumed for a different identity than it was issued for', async () => {
      const issuedFor = loginIdentity('127.0.0.1', 'default', 'ivan');
      const challenge = await issueChallenge(issuedFor, 'default');
      const outcome = await verifyChallenge(challenge.challenge_id, challenge.piece_x!, humanTrail(challenge.piece_x!), 'pointer');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('expected solve to succeed');

      const someoneElse = loginIdentity('9.9.9.9', 'default', 'ivan');
      expect(await consumeCaptchaPass(outcome.captchaPass, someoneElse)).toBe(false);
      // The token is still burned by the mismatched attempt (getdel already removed it) —
      // the legitimate identity can't retry it either.
      expect(await consumeCaptchaPass(outcome.captchaPass, issuedFor)).toBe(false);
    });
  });
});
