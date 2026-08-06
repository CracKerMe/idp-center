import * as jose from 'jose';
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
  let jwt = new jose.SignJWT(claims)
    .setProtectedHeader({ alg: signer.alg, kid: signer.kid, ...extraHeader })
    .setIssuedAt(now)
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
 */
export async function verifyInternalJwt(token: string): Promise<jose.JWTPayload> {
  const header = jose.decodeProtectedHeader(token);

  if (header.alg === 'HS256') {
    const { payload } = await jose.jwtVerify(token, hmacSecret(), { algorithms: ['HS256'] });
    return payload;
  }

  if (header.alg === 'RS256') {
    if (!header.kid) throw new Error('RS256 token missing kid');
    const key = await getVerificationKey(header.kid);
    if (!key) throw new Error(`Unknown signing key: ${header.kid}`);
    const { payload } = await jose.jwtVerify(token, key, { algorithms: ['RS256'] });
    return payload;
  }

  throw new Error(`Unsupported JWT alg: ${header.alg}`);
}
