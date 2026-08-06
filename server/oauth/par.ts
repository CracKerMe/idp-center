import crypto from 'crypto';
import type { Request, Response } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../database.js';
import { pushedAuthRequests } from '../schema.js';
import { authenticateClient } from './client-auth.js';
import { OAuthError, sendOAuthError } from './errors.js';

export const PAR_REQUEST_URI_PREFIX = 'urn:ietf:params:oauth:request_uri:';
const PAR_TTL_MS = 90 * 1000; // RFC 9126 recommends a short lifetime, typically 60-90s

// POST /api/oidc/par — RFC 9126 Pushed Authorization Requests.
// Stores the full /authorize param set server-side; the client gets back an
// opaque request_uri to redirect the user-agent with instead of the raw params.
export async function handlePar(req: Request, res: Response) {
  try {
    const client = await authenticateClient(req);

    // response_type is the one /authorize-only param PAR still requires up front.
    if (typeof req.body?.response_type !== 'string') {
      throw new OAuthError('invalid_request', 400, 'response_type is required');
    }

    // client_id/client_secret/client_assertion* already did their job during
    // authenticateClient() — don't persist raw credentials into the PAR payload.
    const { client_id, client_secret, client_assertion, client_assertion_type, ...authorizeParams } = req.body || {};

    const requestUri = `${PAR_REQUEST_URI_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + PAR_TTL_MS);

    await db.insert(pushedAuthRequests).values({
      requestUri,
      clientId: client.clientId,
      tenantId: client.tenantId,
      payload: JSON.stringify({ ...authorizeParams, client_id: client.clientId }),
      expiresAt,
    });

    res.status(201).json({ request_uri: requestUri, expires_in: Math.floor(PAR_TTL_MS / 1000) });
  } catch (err) {
    sendOAuthError(res, err);
  }
}

/**
 * Resolves a PAR request_uri into the stored /authorize params, single-use.
 * Returns null if unknown/expired/already-redeemed/client-mismatched — callers
 * should treat that identically to an invalid_request on /authorize.
 */
export async function resolvePar(requestUri: string, clientId: string, tenantId: string): Promise<Record<string, any> | null> {
  // Atomic single-use redemption: the isNull(usedAt) guard in the WHERE clause
  // means a concurrent or repeat resolve of the same request_uri loses the race
  // and gets back no row, instead of re-reading an already-consumed payload.
  const [row] = await db
    .update(pushedAuthRequests)
    .set({ usedAt: new Date() })
    .where(and(
      eq(pushedAuthRequests.requestUri, requestUri),
      eq(pushedAuthRequests.clientId, clientId),
      eq(pushedAuthRequests.tenantId, tenantId),
      isNull(pushedAuthRequests.usedAt),
    ))
    .returning();

  if (!row) return null;
  if (row.expiresAt < new Date()) return null;

  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

/**
 * Non-consuming lookup used by GET /authorize to render consent info without
 * burning the request_uri's single use — the actual redemption happens later,
 * in POST /authorize, via resolvePar().
 */
export async function peekPar(requestUri: string, clientId: string, tenantId: string): Promise<Record<string, any> | null> {
  const [row] = await db
    .select()
    .from(pushedAuthRequests)
    .where(and(
      eq(pushedAuthRequests.requestUri, requestUri),
      eq(pushedAuthRequests.clientId, clientId),
      eq(pushedAuthRequests.tenantId, tenantId),
      isNull(pushedAuthRequests.usedAt),
    ))
    .limit(1);

  if (!row || row.expiresAt < new Date()) return null;

  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}
