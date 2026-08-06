import crypto from 'crypto';
import * as jose from 'jose';
import type { Request } from 'express';
import { db } from '../database.js';
import { config } from '../config.js';
import { dpopJtis } from '../schema.js';
import { OAuthError } from './errors.js';

const MAX_PROOF_AGE_SEC = 60;

function canonicalHtu(req: Request): string {
  const url = new URL(req.originalUrl, config.APP_URL);
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * RFC 9449 DPoP proof verification. Returns the jkt (JWK SHA-256 thumbprint) of
 * the proof's embedded public key on success — callers use it to either bind a
 * freshly-issued access token (`cnf.jkt`) or to confirm a resource request's
 * proof matches the token's existing binding.
 *
 * `expectedAth` — when checking a resource request against an already-issued
 * DPoP-bound token, pass the raw access token so its ath claim is verified too.
 */
export async function verifyDpopProof(req: Request, opts?: { expectedAth?: string }): Promise<string> {
  const header = req.headers['dpop'];
  const proof = Array.isArray(header) ? header[0] : header;
  if (!proof) throw new OAuthError('invalid_dpop_proof', 400, 'DPoP header is required');

  let protectedHeader: jose.ProtectedHeaderParameters;
  try {
    protectedHeader = jose.decodeProtectedHeader(proof);
  } catch {
    throw new OAuthError('invalid_dpop_proof', 400, 'Malformed DPoP proof');
  }

  if (protectedHeader.typ !== 'dpop+jwt') {
    throw new OAuthError('invalid_dpop_proof', 400, 'DPoP proof must have typ=dpop+jwt');
  }
  const jwk = protectedHeader.jwk as jose.JWK | undefined;
  if (!jwk || jwk.d) {
    // A private-key field (`d`) has no business being in a proof header — reject outright.
    throw new OAuthError('invalid_dpop_proof', 400, 'DPoP proof must embed a public JWK');
  }

  let payload: jose.JWTPayload;
  try {
    const key = await jose.importJWK(jwk, protectedHeader.alg);
    ({ payload } = await jose.jwtVerify(proof, key as any, { algorithms: [protectedHeader.alg!] }));
  } catch {
    throw new OAuthError('invalid_dpop_proof', 400, 'DPoP proof signature is invalid');
  }

  if (payload.htm !== req.method) {
    throw new OAuthError('invalid_dpop_proof', 400, 'DPoP htm does not match request method');
  }
  if (payload.htu !== canonicalHtu(req)) {
    throw new OAuthError('invalid_dpop_proof', 400, 'DPoP htu does not match request URI');
  }
  const iat = typeof payload.iat === 'number' ? payload.iat : undefined;
  if (!iat || Math.abs(Date.now() / 1000 - iat) > MAX_PROOF_AGE_SEC) {
    throw new OAuthError('invalid_dpop_proof', 400, 'DPoP proof is expired or not yet valid');
  }
  const jti = typeof payload.jti === 'string' ? payload.jti : undefined;
  if (!jti) throw new OAuthError('invalid_dpop_proof', 400, 'DPoP proof is missing jti');

  if (opts?.expectedAth) {
    const expectedAth = crypto.createHash('sha256').update(opts.expectedAth).digest('base64url');
    if (payload.ath !== expectedAth) {
      throw new OAuthError('invalid_dpop_proof', 400, 'DPoP ath does not match the presented access token');
    }
  }

  const jkt = await jose.calculateJwkThumbprint(jwk, 'sha256');

  try {
    await db.insert(dpopJtis).values({
      jti,
      jkt,
      expiresAt: new Date(Date.now() + MAX_PROOF_AGE_SEC * 1000),
    });
  } catch {
    throw new OAuthError('invalid_dpop_proof', 400, 'DPoP proof jti has already been used');
  }

  return jkt;
}
