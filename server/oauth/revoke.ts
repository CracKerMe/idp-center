import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../database.js';
import { refreshTokens } from '../schema.js';
import { authenticateClient } from './client-auth.js';
import { resolveToken } from './token-lookup.js';
import { revokeToken, RevokeReason } from '../utils/token-blacklist.js';
import { OAuthError, sendOAuthError } from './errors.js';

/**
 * RFC 7009 token revocation. Always 200 with an empty body — including for
 * unknown tokens and tokens owned by a different client — so the endpoint
 * never leaks whether a given token string exists.
 */
export async function handleRevoke(req: Request, res: Response): Promise<void> {
  try {
    const client = await authenticateClient(req);

    const token = req.body?.token;
    if (!token) throw new OAuthError('invalid_request', 400, 'token is required');

    const hint = req.body?.token_type_hint === 'refresh_token' ? 'refresh_token' : req.body?.token_type_hint === 'access_token' ? 'access_token' : undefined;
    const resolved = await resolveToken(token, client.tenantId, hint);

    if (!resolved || resolved.row.clientId !== client.clientId) {
      res.status(200).end();
      return;
    }

    if (resolved.kind === 'access') {
      await revokeToken(token, RevokeReason.LOGOUT);
    } else {
      // TODO(§1.5 oidc_sessions): once refresh tokens carry oidc_session_id, cascade
      // to revoke every access token issued under the same session (RFC 7009 §2.1 SHOULD).
      await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, resolved.row.id));
    }

    res.status(200).end();
  } catch (err) {
    sendOAuthError(res, err);
  }
}
