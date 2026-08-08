import { and, eq } from 'drizzle-orm';
import { db } from '../../database.js';
import { TOKEN_CONFIG } from '../../config.js';
import { getValue } from '../../services/feature.service.js';
import { refreshTokens, users, oidcSessions } from '../../schema.js';
import { OAuthError } from '../errors.js';
import { issueAccessToken, issueRefreshToken, issueIdToken } from '../issue.js';
import { revokeTokensBySession, RevokeReason } from '../../utils/token-blacklist.js';
import { assessLoginRisk } from '../../services/risk.service.js';
import { computeDeviceFingerprint } from '../../utils/device-fingerprint.js';
import { uebaSessionRevocations } from '../../utils/metrics.js';
import { logger } from '../../utils/logger.js';
import type { GrantContext, GrantHandler, TokenResponse } from '../types.js';

// A session's risk score jumping by more than this between refreshes (e.g. the refresh
// token got stolen and is now being replayed from a different network) forces
// re-authentication rather than silently minting a fresh access token. See §3.2 UEBA.
const SESSION_RISK_JUMP_THRESHOLD = 40;

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
      // Reuse of an already-rotated refresh token: revoke the whole family AND
      // every access token issued under the same OIDC session, otherwise the
      // attacker keeps a live access token for up to its full TTL
      // (RFC 6749 §10.4 refresh-token-reuse detection).
      if (rtRecord.familyId) {
        await db
          .update(refreshTokens)
          .set({ revoked: true })
          .where(and(eq(refreshTokens.familyId, rtRecord.familyId), eq(refreshTokens.tenantId, tenantId)));
      }
      if (rtRecord.oidcSessionId) {
        await revokeTokensBySession(rtRecord.oidcSessionId, RevokeReason.SECURITY_BREACH);
      }
      throw new OAuthError('invalid_grant', 400, 'Refresh token has already been used');
    }

    if (rtRecord.expiresAt < new Date()) {
      throw new OAuthError('invalid_grant', 400, 'Refresh token expired');
    }

    const [user] = await db.select().from(users).where(eq(users.id, rtRecord.userId)).limit(1);
    if (!user) throw new OAuthError('invalid_grant', 400, 'User not found');
    if (!user.isActive) throw new OAuthError('invalid_grant', 403, 'User account is disabled');

    // Atomic rotation: concurrent requests presenting the same token must not both
    // succeed. Only the request whose UPDATE actually flips revoked=false -> true wins.
    const [claimed] = await db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(and(eq(refreshTokens.id, rtRecord.id), eq(refreshTokens.revoked, false)))
      .returning();

    if (!claimed) {
      throw new OAuthError('invalid_grant', 400, 'Refresh token has already been used');
    }

    const scope = rtRecord.scope || 'openid';
    // The OIDC session link must survive rotation, or back-channel logout silently
    // stops revoking anything after the first refresh.
    const oidcSessionId = rtRecord.oidcSessionId ?? undefined;

    const { token: newRefreshToken } = await issueRefreshToken({
      userId: user.id,
      clientId: client.clientId,
      tenantId,
      scope,
      familyId: rtRecord.familyId ?? undefined,
      rememberMe: rtRecord.rememberMe ?? false,
      oidcSessionId,
    });

    let authCtx: { amr?: string | null; acr?: string | null } = {};
    let sid: string | undefined;
    let authTime: Date | undefined;
    if (oidcSessionId) {
      const [oidcSession] = await db
        .select({ sid: oidcSessions.sid, amr: oidcSessions.amr, acr: oidcSessions.acr, authTime: oidcSessions.authTime, riskScore: oidcSessions.riskScore })
        .from(oidcSessions)
        .where(eq(oidcSessions.id, oidcSessionId))
        .limit(1);
      if (oidcSession) {
        authCtx = { amr: oidcSession.amr, acr: oidcSession.acr };
        sid = oidcSession.sid;
        authTime = oidcSession.authTime ?? undefined;

        if (getValue('riskEngine') !== 'off') {
          const ip = ctx.req.ip || ctx.req.socket?.remoteAddress || 'unknown';
          const userAgent = ctx.req.get('User-Agent') || '';
          const assessment = await assessLoginRisk({
            userId: user.id, tenantId, clientId: client.clientId, ip, userAgent,
            deviceFingerprint: computeDeviceFingerprint(userAgent, ip),
          });

          const jumped = oidcSession.riskScore != null && assessment.score - oidcSession.riskScore >= SESSION_RISK_JUMP_THRESHOLD;
          if (getValue('riskEngine') === 'enforce' && jumped) {
            await revokeTokensBySession(oidcSessionId, RevokeReason.SECURITY_BREACH);
            await db.update(oidcSessions).set({ terminatedAt: new Date(), riskScore: assessment.score }).where(eq(oidcSessions.id, oidcSessionId));
            uebaSessionRevocations.inc({ tenant_id: tenantId });
            logger.warn(`OIDC session ${oidcSessionId} revoked on refresh: risk score jumped ${oidcSession.riskScore} -> ${assessment.score}`);
            throw new OAuthError('invalid_grant', 400, 'Session revoked due to elevated risk — please sign in again');
          }

          await db.update(oidcSessions).set({ riskScore: assessment.score }).where(eq(oidcSessions.id, oidcSessionId));
        }
      }
    }

    const { token: newAccessToken } = await issueAccessToken(user, client.clientId, scope, tenantId, oidcSessionId, undefined, authCtx);
    const idToken = await issueIdToken(user, { clientId: client.clientId, scope, sid, authTime, ...authCtx });

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_type: 'Bearer',
      expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
      scope,
      id_token: idToken,
    };
  },
};
