import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../database.js';
import { TOKEN_CONFIG } from '../../config.js';
import { authCodes, users, oidcSessions, accessTokens, refreshTokens } from '../../schema.js';
import { OAuthError } from '../errors.js';
import { issueAccessToken, issueRefreshToken, issueIdToken } from '../issue.js';
import { verifyDpopProof } from '../dpop.js';
import { RevokeReason } from '../../utils/token-blacklist.js';
import type { GrantContext, GrantHandler, TokenResponse } from '../types.js';

function verifyPkce(method: string, verifier: string, challenge: string): boolean {
  if (method === 'plain') return verifier === challenge;
  if (method === 'S256') {
    return crypto.createHash('sha256').update(verifier).digest('base64url') === challenge;
  }
  return false;
}

/**
 * A replayed authorization code means the code leaked. RFC 6749 §4.1.2 / OAuth 2.1
 * §4.1.3: revoke everything the code previously minted.
 */
async function revokeTokensFromAuthCode(authCodeId: string): Promise<void> {
  await db
    .update(accessTokens)
    .set({ revoked: true, revokedAt: new Date(), revokeReason: RevokeReason.SECURITY_BREACH })
    .where(and(eq(accessTokens.authCodeId, authCodeId), eq(accessTokens.revoked, false)));
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(and(eq(refreshTokens.authCodeId, authCodeId), eq(refreshTokens.revoked, false)));
}

export const authorizationCodeGrant: GrantHandler = {
  grantType: 'authorization_code',
  requiresClientAuth: true,

  async handle(ctx: GrantContext): Promise<TokenResponse> {
    const { params, client, tenantId } = ctx;
    const code = params.code;
    const redirectUri = params.redirect_uri;
    if (!code || !redirectUri) {
      throw new OAuthError('invalid_request', 400, 'code and redirect_uri are required');
    }

    // Atomic claim-and-consume: an unconditional UPDATE...WHERE used=false closes the
    // race where the same code could be redeemed twice by concurrent requests.
    const [authCode] = await db
      .update(authCodes)
      .set({ used: true })
      .where(and(
        eq(authCodes.code, code),
        eq(authCodes.clientId, client.clientId),
        eq(authCodes.tenantId, tenantId),
        eq(authCodes.redirectUri, redirectUri),
        eq(authCodes.used, false),
      ))
      .returning();

    if (!authCode) {
      // The code may exist but already be consumed — that is a replay, and every
      // token it previously issued must die with it.
      const [replayed] = await db
        .select({ id: authCodes.id })
        .from(authCodes)
        .where(and(eq(authCodes.code, code), eq(authCodes.tenantId, tenantId), eq(authCodes.used, true)))
        .limit(1);
      if (replayed) await revokeTokensFromAuthCode(replayed.id);
      throw new OAuthError('invalid_grant', 400, 'Invalid or expired code');
    }

    if (authCode.expiresAt < new Date()) {
      throw new OAuthError('invalid_grant', 400, 'Invalid or expired code');
    }

    if (authCode.codeChallenge) {
      const method = authCode.codeChallengeMethod || 'S256';
      if (!params.code_verifier) {
        throw new OAuthError('invalid_request', 400, 'code_verifier is required');
      }
      if (!verifyPkce(method, params.code_verifier, authCode.codeChallenge)) {
        throw new OAuthError('invalid_grant', 400, 'Invalid code_verifier');
      }
    }

    const [user] = await db.select().from(users).where(eq(users.id, authCode.userId)).limit(1);
    if (!user) throw new OAuthError('invalid_grant', 400, 'User not found');
    if (!user.isActive) throw new OAuthError('invalid_grant', 400, 'User account is disabled');

    const oidcSession = authCode.sid
      ? (await db.select().from(oidcSessions).where(and(eq(oidcSessions.sid, authCode.sid), eq(oidcSessions.tenantId, tenantId))).limit(1))[0]
      : undefined;

    // RFC 9449: presence of a DPoP header opts this issuance into DPoP binding.
    // A proof that fails verification throws before any token is issued.
    const jkt = ctx.req.headers['dpop'] ? await verifyDpopProof(ctx.req) : undefined;

    const scope = authCode.scope || 'openid';
    const authCtx = { amr: oidcSession?.amr, acr: oidcSession?.acr };
    const { token: accessToken } = await issueAccessToken(user, client.clientId, scope, tenantId, oidcSession?.id, jkt ? { jkt } : undefined, authCtx, authCode.id);
    const { token: refreshToken } = await issueRefreshToken({ userId: user.id, clientId: client.clientId, tenantId, scope, oidcSessionId: oidcSession?.id, authCodeId: authCode.id });
    const idToken = await issueIdToken(user, { clientId: client.clientId, scope, nonce: authCode.nonce, sid: oidcSession?.sid, authTime: oidcSession?.authTime, ...authCtx });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: jkt ? 'DPoP' : 'Bearer',
      expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
      scope,
      id_token: idToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.isAdmin,
        tenant_id: user.tenantId,
      },
    };
  },
};
