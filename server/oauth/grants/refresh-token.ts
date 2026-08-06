import { and, eq } from 'drizzle-orm';
import { db } from '../../database.js';
import { TOKEN_CONFIG } from '../../config.js';
import { refreshTokens, users } from '../../schema.js';
import { OAuthError } from '../errors.js';
import { issueAccessToken, issueRefreshToken, issueIdToken } from '../issue.js';
import type { GrantContext, GrantHandler, TokenResponse } from '../types.js';

export const refreshTokenGrant: GrantHandler = {
  grantType: 'refresh_token',
  requiresClientAuth: true,

  async handle(ctx: GrantContext): Promise<TokenResponse> {
    const { params, client, tenantId } = ctx;
    const presented = params.refresh_token;
    if (!presented) throw new OAuthError('invalid_request', 400, 'refresh_token is required');

    const [rtRecord] = await db
      .select()
      .from(refreshTokens)
      .where(and(
        eq(refreshTokens.token, presented),
        eq(refreshTokens.clientId, client.clientId),
        eq(refreshTokens.tenantId, tenantId),
      ))
      .limit(1);

    if (!rtRecord) throw new OAuthError('invalid_grant', 400, 'Invalid refresh_token');

    if (rtRecord.revoked) {
      // Reuse of an already-rotated refresh token: revoke the whole family
      // (RFC 6749 §10.4 refresh-token-reuse detection).
      if (rtRecord.familyId) {
        await db
          .update(refreshTokens)
          .set({ revoked: true })
          .where(and(eq(refreshTokens.familyId, rtRecord.familyId), eq(refreshTokens.tenantId, tenantId)));
      }
      throw new OAuthError('invalid_grant', 400, 'Refresh token has already been used');
    }

    if (rtRecord.expiresAt < new Date()) {
      throw new OAuthError('invalid_grant', 400, 'Refresh token expired');
    }

    const [user] = await db.select().from(users).where(eq(users.id, rtRecord.userId)).limit(1);
    if (!user) throw new OAuthError('invalid_grant', 400, 'User not found');
    if (!user.isActive) throw new OAuthError('invalid_grant', 403, 'User account is disabled');

    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, rtRecord.id));

    const scope = rtRecord.scope || 'openid';
    const { token: newRefreshToken } = await issueRefreshToken({
      userId: user.id,
      clientId: client.clientId,
      tenantId,
      scope,
      familyId: rtRecord.familyId ?? undefined,
      rememberMe: rtRecord.rememberMe ?? false,
    });
    const { token: newAccessToken } = await issueAccessToken(user, client.clientId, scope, tenantId);
    const idToken = issueIdToken(user, { clientId: client.clientId, scope });

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_type: 'Bearer',
      expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
      id_token: idToken,
    };
  },
};
