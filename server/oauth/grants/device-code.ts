import { and, eq } from 'drizzle-orm';
import { db } from '../../database.js';
import { TOKEN_CONFIG } from '../../config.js';
import { deviceCodes, users } from '../../schema.js';
import { OAuthError } from '../errors.js';
import { issueAccessToken, issueRefreshToken, issueIdToken } from '../issue.js';
import type { GrantContext, GrantHandler, TokenResponse } from '../types.js';

export const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export const deviceCodeGrant: GrantHandler = {
  grantType: DEVICE_CODE_GRANT_TYPE,
  requiresClientAuth: true,

  async handle(ctx: GrantContext): Promise<TokenResponse> {
    const { params, client, tenantId } = ctx;
    const deviceCode = params.device_code;
    if (!deviceCode) throw new OAuthError('invalid_request', 400, 'device_code is required');

    const [row] = await db
      .select()
      .from(deviceCodes)
      .where(and(
        eq(deviceCodes.deviceCode, deviceCode),
        eq(deviceCodes.clientId, client.clientId),
        eq(deviceCodes.tenantId, tenantId),
      ))
      .limit(1);

    if (!row) throw new OAuthError('invalid_grant', 400, 'Unknown device_code');
    if (row.expiresAt < new Date()) throw new OAuthError('expired_token', 400, 'device_code has expired');

    if (row.status === 'denied') throw new OAuthError('access_denied', 400, 'User denied the request');
    if (row.status === 'redeemed') throw new OAuthError('invalid_grant', 400, 'device_code has already been redeemed');

    if (row.status === 'pending') {
      const now = new Date();
      if (row.lastPolledAt && now.getTime() - row.lastPolledAt.getTime() < row.interval * 1000) {
        const newInterval = row.interval + 5;
        await db.update(deviceCodes).set({ interval: newInterval, lastPolledAt: now, pollCount: row.pollCount + 1 }).where(eq(deviceCodes.id, row.id));
        throw new OAuthError('slow_down', 400, 'Polling too frequently');
      }
      await db.update(deviceCodes).set({ lastPolledAt: now, pollCount: row.pollCount + 1 }).where(eq(deviceCodes.id, row.id));
      throw new OAuthError('authorization_pending', 400, 'User has not yet approved the request');
    }

    // status === 'approved': atomically claim it so concurrent polls can't both redeem it.
    const [claimed] = await db
      .update(deviceCodes)
      .set({ status: 'redeemed' })
      .where(and(eq(deviceCodes.id, row.id), eq(deviceCodes.status, 'approved')))
      .returning();

    if (!claimed || !claimed.userId) throw new OAuthError('invalid_grant', 400, 'device_code is not approved');

    const [user] = await db.select().from(users).where(eq(users.id, claimed.userId)).limit(1);
    if (!user) throw new OAuthError('invalid_grant', 400, 'User not found');

    const scope = claimed.scope || 'openid';
    const { token: accessToken } = await issueAccessToken(user, client.clientId, scope, tenantId);
    const { token: refreshToken } = await issueRefreshToken({ userId: user.id, clientId: client.clientId, tenantId, scope });

    const response: TokenResponse = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
    };
    if (scope.includes('openid')) {
      response.id_token = await issueIdToken(user, { clientId: client.clientId, scope, nonce: claimed.nonce });
    }
    return response;
  },
};
