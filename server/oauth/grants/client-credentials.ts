import { TOKEN_CONFIG } from '../../config.js';
import { parseList } from '../client-auth.js';
import { OAuthError } from '../errors.js';
import { issueClientAccessToken } from '../issue.js';
import { verifyDpopProof } from '../dpop.js';
import { isEnabled } from '../../services/feature.service.js';
import type { GrantContext, GrantHandler, TokenResponse } from '../types.js';

export const clientCredentialsGrant: GrantHandler = {
  grantType: 'client_credentials',
  requiresClientAuth: true,

  async handle(ctx: GrantContext): Promise<TokenResponse> {
    const { params, client, tenantId } = ctx;

    const allowedScopes = parseList(client.row.allowedScopes);
    const requestedScopes = typeof params.scope === 'string' && params.scope.trim()
      ? params.scope.trim().split(/\s+/)
      : allowedScopes;

    const grantedScopes = requestedScopes.filter((s: string) => allowedScopes.includes(s));
    if (grantedScopes.length === 0) {
      throw new OAuthError('invalid_scope', 400, 'Client has no allowed scopes for this request');
    }
    const scope = grantedScopes.join(' ');

    const jkt = isEnabled('dpop') && ctx.req.headers['dpop'] ? await verifyDpopProof(ctx.req) : undefined;
    const { token: accessToken } = await issueClientAccessToken(client.clientId, scope, tenantId, jkt ? { jkt } : undefined);

    return {
      access_token: accessToken,
      token_type: jkt ? 'DPoP' : 'Bearer',
      expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
      scope,
    };
  },
};
