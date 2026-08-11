import express from 'express';
import { config } from '../config.js';
import { publishJwks } from '../services/keys.service.js';
import { jwksRequests } from '../utils/metrics.js';
import { isEnabled } from '../services/feature.service.js';

const router = express.Router();

// GET /.well-known/openid-configuration
router.get('/openid-configuration', (req, res) => {
  const issuer = config.APP_URL;
  const deviceFlowOn = isEnabled('deviceFlow');
  const dcrOn = isEnabled('dynamicClientRegistration');
  const tokenExchangeOn = isEnabled('tokenExchange');
  const parOn = isEnabled('par');
  const dpopOn = isEnabled('dpop');
  const clientSecretJwtOn = isEnabled('clientSecretJwt');
  const privateKeyJwtOn = isEnabled('privateKeyJwt');

  const grantTypesSupported = [
    'authorization_code',
    'refresh_token',
    'client_credentials',
    ...(deviceFlowOn ? ['urn:ietf:params:oauth:grant-type:device_code'] : []),
    ...(tokenExchangeOn ? ['urn:ietf:params:oauth:grant-type:token-exchange'] : []),
  ];

  res.json({
    issuer,
    authorization_endpoint: `${issuer}/api/oidc/authorize`,
    token_endpoint: `${issuer}/api/oidc/token`,
    userinfo_endpoint: `${issuer}/api/oidc/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    introspection_endpoint: `${issuer}/api/oidc/introspect`,
    revocation_endpoint: `${issuer}/api/oidc/revoke`,
    ...(deviceFlowOn ? { device_authorization_endpoint: `${issuer}/api/oidc/device_authorization` } : {}),
    end_session_endpoint: `${issuer}/api/oidc/end_session`,
    ...(parOn ? { pushed_authorization_request_endpoint: `${issuer}/api/oidc/par`, require_pushed_authorization_requests: false } : {}),
    ...(dcrOn ? { registration_endpoint: `${issuer}/api/oidc/register` } : {}),
    ...(dpopOn ? { dpop_signing_alg_values_supported: ['RS256', 'ES256'] } : {}),
    response_types_supported: ['code'],
    grant_types_supported: grantTypesSupported,
    scopes_supported: ['openid', 'profile', 'email', 'roles', 'groups', 'scim:read', 'scim:write'],
    id_token_signing_alg_values_supported: ['RS256'],
    userinfo_signing_alg_values_supported: ['none'],
    request_object_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256', 'plain'],
    subject_types_supported: ['public'],
    token_endpoint_auth_methods_supported: [
      'client_secret_post', 'client_secret_basic',
      ...(clientSecretJwtOn ? ['client_secret_jwt'] : []),
      ...(privateKeyJwtOn ? ['private_key_jwt'] : []),
    ],
    introspection_endpoint_auth_methods_supported: [
      'client_secret_post', 'client_secret_basic',
      ...(clientSecretJwtOn ? ['client_secret_jwt'] : []),
      ...(privateKeyJwtOn ? ['private_key_jwt'] : []),
    ],
    revocation_endpoint_auth_methods_supported: [
      'client_secret_post', 'client_secret_basic',
      ...(clientSecretJwtOn ? ['client_secret_jwt'] : []),
      ...(privateKeyJwtOn ? ['private_key_jwt'] : []),
    ],
    token_endpoint_auth_signing_alg_values_supported: ['HS256', 'RS256', 'ES256'],
    frontchannel_logout_supported: true,
    frontchannel_logout_session_supported: true,
    backchannel_logout_supported: true,
    backchannel_logout_session_supported: true,
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'sid', 'auth_time', 'email', 'name', 'preferred_username', 'acr', 'amr'],
    acr_values_supported: ['0', '1'],
  });
});

// GET /.well-known/jwks.json
router.get('/jwks.json', async (req, res) => {
  jwksRequests.inc();
  const jwks = await publishJwks();
  res.set('Cache-Control', 'public, max-age=300');
  res.json(jwks);
});

export default router;
