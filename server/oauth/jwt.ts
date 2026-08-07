import * as jose from 'jose';
import crypto from 'crypto';
import { config } from '../config.js';
import { getActiveSigner, getVerificationKey } from '../services/keys.service.js';

const hmacSecret = () => new TextEncoder().encode(config.JWT_SECRET);

export interface SignOpts {
  audience?: string;
  expiresInSec: number;
}

async function sign(claims: Record<string, unknown>, opts: SignOpts, extraHeader?: Record<string, unknown>): Promise<string> {
  const signer = await getActiveSigner();
  const now = Math.floor(Date.now() / 1000);
  // A unique jti guarantees every signed token is byte-distinct. Without it, two
  // tokens minted for the same subject/scope within one second (iat/exp are
  // second-resolution) would be identical and collide on access_tokens.token's
  // UNIQUE constraint. A caller-supplied jti (e.g. back-channel logout tokens) is
  // preserved; everything else gets a fresh one.
  const jti = typeof claims.jti === 'string' ? claims.jti : crypto.randomUUID();
  let jwt = new jose.SignJWT(claims)
    .setProtectedHeader({ alg: signer.alg, kid: signer.kid, ...extraHeader })
    .setIssuedAt(now)
    .setJti(jti)
    .setExpirationTime(now + opts.expiresInSec)
    .setIssuer(config.APP_URL);

  if (opts.audience) jwt = jwt.setAudience(opts.audience);

  return jwt.sign(signer.key);
}

export async function signIdToken(claims: Record<string, unknown>, opts: { audience: string; expiresInSec: number }): Promise<string> {
  return sign(claims, opts);
}

export async function signAccessToken(claims: Record<string, unknown>, opts: { expiresInSec: number }): Promise<string> {
  return sign(claims, opts);
}

export async function signLogoutToken(claims: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ ...claims, iat: now }, { audience: claims.aud as string | undefined, expiresInSec: 120 }, { typ: 'logout+jwt' });
}

/**
 * Verifies either an HS256 (legacy) or RS256 (current) internally-issued JWT.
 * Never falls back across algorithm families — an unknown RS256 kid is rejected outright,
 * not retried as HMAC (that would be an alg-confusion vulnerability).
 *
 * `ignoreExpiration` exists solely for RP-initiated logout's id_token_hint: that
 * token is expected to be expired by the time the user logs out, but its
 * signature still needs checking to trust the sub/sid it carries.
 */
export async function verifyInternalJwt(token: string, opts?: { ignoreExpiration?: boolean }): Promise<jose.JWTPayload> {
  const header = jose.decodeProtectedHeader(token);
  // A huge clockTolerance is jose's supported way to skip exp/nbf enforcement
  // without hand-rolling verification — the signature check is unaffected.
  const verifyOpts = opts?.ignoreExpiration ? { clockTolerance: 100 * 365 * 24 * 60 * 60 } : {};

  if (header.alg === 'HS256') {
    const { payload } = await jose.jwtVerify(token, hmacSecret(), { algorithms: ['HS256'], ...verifyOpts });
    return payload;
  }

  if (header.alg === 'RS256') {
    if (!header.kid) throw new Error('RS256 token missing kid');
    const key = await getVerificationKey(header.kid);
    if (!key) throw new Error(`Unknown signing key: ${header.kid}`);
    const { payload } = await jose.jwtVerify(token, key, { algorithms: ['RS256'], ...verifyOpts });
    return payload;
  }

  throw new Error(`Unsupported JWT alg: ${header.alg}`);
}
