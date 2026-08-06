import express from 'express';
import { config } from '../config.js';
import { publishJwks } from '../services/keys.service.js';

const router = express.Router();

// GET /.well-known/openid-configuration
router.get('/openid-configuration', (req, res) => {
  const issuer = config.APP_URL;
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/api/oidc/authorize`,
    token_endpoint: `${issuer}/api/oidc/token`,
    userinfo_endpoint: `${issuer}/api/oidc/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    introspection_endpoint: `${issuer}/api/oidc/introspect`,
    revocation_endpoint: `${issuer}/api/oidc/revoke`,
    device_authorization_endpoint: `${issuer}/api/oidc/device_authorization`,
    end_session_endpoint: `${issuer}/api/oidc/end_session`,
    pushed_authorization_request_endpoint: `${issuer}/api/oidc/par`,
    require_pushed_authorization_requests: false,
    registration_endpoint: `${issuer}/api/oidc/register`,
    dpop_signing_alg_values_supported: ['RS256', 'ES256'],
    response_types_supported: ['code'],
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'client_credentials',
      'urn:ietf:params:oauth:grant-type:device_code',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ],
    scopes_supported: ['openid', 'profile', 'email'],
    id_token_signing_alg_values_supported: ['HS256'],
    code_challenge_methods_supported: ['S256', 'plain'],
    subject_types_supported: ['public'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'client_secret_jwt', 'private_key_jwt'],
    introspection_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'client_secret_jwt', 'private_key_jwt'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'client_secret_jwt', 'private_key_jwt'],
    token_endpoint_auth_signing_alg_values_supported: ['HS256', 'RS256', 'ES256'],
    frontchannel_logout_supported: true,
    frontchannel_logout_session_supported: true,
    backchannel_logout_supported: true,
    backchannel_logout_session_supported: true,
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'sid', 'auth_time', 'email', 'name', 'preferred_username'],
  });
});

// GET /.well-known/jwks.json
router.get('/jwks.json', async (req, res) => {
  const jwks = await publishJwks();
  res.set('Cache-Control', 'public, max-age=300');
  res.json(jwks);
});

export default router;
