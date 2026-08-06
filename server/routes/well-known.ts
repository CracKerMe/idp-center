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
    response_types_supported: ['code'],
    scopes_supported: ['openid', 'profile', 'email'],
    id_token_signing_alg_values_supported: ['HS256'],
    code_challenge_methods_supported: ['S256'],
    subject_types_supported: ['public'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'email', 'name', 'preferred_username'],
  });
});

// GET /.well-known/jwks.json
router.get('/jwks.json', async (req, res) => {
  const jwks = await publishJwks();
  res.set('Cache-Control', 'public, max-age=300');
  res.json(jwks);
});

export default router;
