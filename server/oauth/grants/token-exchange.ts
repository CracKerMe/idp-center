import { eq } from 'drizzle-orm';
import { db } from '../../database.js';
import { TOKEN_CONFIG } from '../../config.js';
import { users } from '../../schema.js';
import { parseList } from '../client-auth.js';
import { resolveToken } from '../token-lookup.js';
import { issueAccessToken } from '../issue.js';
import { OAuthError } from '../errors.js';
import type { GrantContext, GrantHandler, TokenResponse } from '../types.js';

export const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

/**
 * RFC 8693 token exchange, v1 scope: only access_token subject tokens, no
 * actor_token/`act` claim support yet (ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md
 * §1.2 flags that as conditional — this covers the required baseline).
 * Cross-tenant exchange is rejected structurally: resolveToken() only finds
 * subject tokens within the requesting client's own tenant.
 */
export const tokenExchangeGrant: GrantHandler = {
  grantType: TOKEN_EXCHANGE_GRANT_TYPE,
  requiresClientAuth: true,

  async handle(ctx: GrantContext): Promise<TokenResponse> {
    const { params, client, tenantId } = ctx;

    if (params.subject_token_type !== ACCESS_TOKEN_TYPE) {
      throw new OAuthError('invalid_request', 400, 'Only the access_token subject_token_type is supported');
    }
    const subjectToken = params.subject_token;
    if (!subjectToken) throw new OAuthError('invalid_request', 400, 'subject_token is required');

    const resolved = await resolveToken(subjectToken, tenantId, 'access_token');
    if (!resolved || resolved.kind !== 'access' || resolved.row.revoked || resolved.row.expiresAt < new Date()) {
      throw new OAuthError('invalid_grant', 400, 'subject_token is invalid, expired, or revoked');
    }

    const requestedAudience = typeof params.audience === 'string' ? params.audience : undefined;
    const allowedAudiences = parseList(client.row.allowedAudiences);
    if (!requestedAudience || !allowedAudiences.includes(requestedAudience)) {
      throw new OAuthError('invalid_target', 400, "Requested audience is not in the client's allowed_audiences");
    }

    const [user] = await db.select().from(users).where(eq(users.id, resolved.row.userId)).limit(1);
    if (!user) throw new OAuthError('invalid_grant', 400, 'Subject token user not found');

    const scope = typeof params.scope === 'string' && params.scope.trim() ? params.scope.trim() : resolved.row.scope || 'openid';
    const { token: accessToken } = await issueAccessToken(user, requestedAudience, scope, tenantId);

    return {
      access_token: accessToken,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: 'Bearer',
      expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
      scope,
    };
  },
};
