import type { GrantHandler } from './types.js';
import { authorizationCodeGrant } from './grants/authorization-code.js';
import { refreshTokenGrant } from './grants/refresh-token.js';
import { clientCredentialsGrant } from './grants/client-credentials.js';
import { deviceCodeGrant } from './grants/device-code.js';
import { tokenExchangeGrant } from './grants/token-exchange.js';

export const grantRegistry: Record<string, GrantHandler> = {
  [authorizationCodeGrant.grantType]: authorizationCodeGrant,
  [refreshTokenGrant.grantType]: refreshTokenGrant,
  [clientCredentialsGrant.grantType]: clientCredentialsGrant,
  [deviceCodeGrant.grantType]: deviceCodeGrant,
  [tokenExchangeGrant.grantType]: tokenExchangeGrant,
};
