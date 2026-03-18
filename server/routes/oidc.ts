import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../database.js';
import { config } from '../config.js';
import { logAudit } from '../utils/audit.js';
import { authenticateToken } from '../middleware/auth.js';
import { success, error, ErrorCode } from '../utils/response.js';

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

// GET /.well-known/jwks.json (HS256 — no public keys to expose)
router.get('/jwks.json', (req, res) => {
  res.json({ keys: [] });
});

// GET /api/oidc/authorize
router.get('/authorize', (req, res) => {
  const { client_id, redirect_uri, scope } = req.query;

  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id);
  if (!client) return res.status(400).json(error('Invalid client_id', ErrorCode.VALIDATION_ERROR));

  const rawUris = (client as any).redirect_uris || '';
  const registeredUris: string[] = rawUris.startsWith('[')
    ? JSON.parse(rawUris)
    : rawUris.split(',').map((u: string) => u.trim()).filter(Boolean);
  if (!redirect_uri || !registeredUris.includes(redirect_uri as string)) {
    return res.status(400).json(error('Invalid redirect_uri', ErrorCode.VALIDATION_ERROR));
  }

  res.json(success({ client_name: (client as any).client_name, scopes: scope }));
});

// POST /api/oidc/authorize
router.post('/authorize', authenticateToken, (req, res) => {
  const { client_id, redirect_uri, response_type, state, nonce, scope, code_challenge, code_challenge_method } = req.body;
  const userId = (req as any).user.id;

  if (response_type !== 'code') return res.status(400).json(error('Unsupported response_type', ErrorCode.VALIDATION_ERROR));

  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id);
  if (!client) return res.status(400).json(error('Invalid client_id', ErrorCode.VALIDATION_ERROR));

  const rawUris = (client as any).redirect_uris || '';
  const registeredUris: string[] = rawUris.startsWith('[')
    ? JSON.parse(rawUris)
    : rawUris.split(',').map((u: string) => u.trim()).filter(Boolean);
  if (!redirect_uri || !registeredUris.includes(redirect_uri as string)) {
    return res.status(400).json(error('Invalid redirect_uri', ErrorCode.VALIDATION_ERROR));
  }

  const code = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
  const authScope = scope || 'openid';
  const challengeMethod = code_challenge_method || 'S256';

  db.prepare('INSERT INTO auth_codes (id, code, client_id, user_id, redirect_uri, expires_at, nonce, scope, code_challenge, code_challenge_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), code, client_id, userId, redirect_uri, expiresAt,
    nonce || null, authScope, code_challenge || null, challengeMethod
  );

  logAudit(userId, 'OAUTH_AUTHORIZE', req, `Authorized client ${client_id}`);

  const redirectUrl = new URL(redirect_uri as string);
  redirectUrl.searchParams.append('code', code);
  if (state) redirectUrl.searchParams.append('state', state as string);

  res.json(success({ redirect_url: redirectUrl.toString() }));
});

// POST /api/oidc/token
router.post('/token', (req, res) => {
  const { grant_type, code, client_id, client_secret, redirect_uri, code_verifier, refresh_token } = req.body;

  if (grant_type === 'refresh_token') {
    if (!refresh_token) return res.status(400).json(error('refresh_token is required', ErrorCode.VALIDATION_REQUIRED));

    const client: any = db.prepare('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?').get(client_id, client_secret);
    if (!client) return res.status(401).json(error('Invalid client credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));

    const rtRecord: any = db.prepare(
      'SELECT * FROM refresh_tokens WHERE token = ? AND client_id = ? AND revoked = 0'
    ).get(refresh_token, client_id);
    if (!rtRecord || new Date(rtRecord.expires_at) < new Date()) {
      return res.status(400).json(error('Invalid or expired refresh_token', ErrorCode.TOKEN_INVALID));
    }

    const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(rtRecord.user_id);
    if (!user) return res.status(400).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(rtRecord.id);
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
      crypto.randomUUID(), newRefreshToken, user.id, client_id, refreshExpiresAt
    );

    const newAccessToken = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin, tenant_id: user.tenant_id },
      config.JWT_SECRET,
      { expiresIn: '24h' }
    );
    const accessExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const tokenScope = rtRecord.scope || 'openid';
    db.prepare('INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, scope) VALUES (?, ?, ?, ?, ?, ?)').run(
      crypto.randomUUID(), newAccessToken, client_id, user.id, accessExpiresAt, tokenScope
    );

    const idTokenPayload: Record<string, any> = {
      iss: config.APP_URL,
      sub: user.id,
      aud: client_id,
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
      iat: Math.floor(Date.now() / 1000),
    };
    if (tokenScope.includes('email')) idTokenPayload.email = user.email;
    if (tokenScope.includes('profile')) {
      idTokenPayload.name = user.full_name || user.username;
      idTokenPayload.preferred_username = user.username;
    }
    const newIdToken = jwt.sign(idTokenPayload, config.JWT_SECRET);

    return res.json({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_type: 'Bearer',
      expires_in: 86400,
      id_token: newIdToken,
    });
  }

  if (grant_type !== 'authorization_code') return res.status(400).json(error('Unsupported grant_type', ErrorCode.VALIDATION_ERROR));

  const client: any = db.prepare('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?').get(client_id, client_secret);
  if (!client) return res.status(401).json(error('Invalid client credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));

  const authCode: any = db.prepare('SELECT * FROM auth_codes WHERE code = ? AND client_id = ? AND redirect_uri = ? AND used = 0').get(code, client_id, redirect_uri);
  if (!authCode || new Date(authCode.expires_at) < new Date()) {
    return res.status(400).json(error('Invalid or expired code', ErrorCode.TOKEN_INVALID));
  }

  if (authCode.code_challenge) {
    if (!code_verifier) return res.status(400).json(error('code_verifier is required', ErrorCode.VALIDATION_REQUIRED));
    const computedChallenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (computedChallenge !== authCode.code_challenge) {
      return res.status(400).json(error('Invalid code_verifier', ErrorCode.VALIDATION_ERROR));
    }
  }

  db.prepare('UPDATE auth_codes SET used = 1 WHERE id = ?').run(authCode.id);

  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(authCode.user_id);
  if (!user) return res.status(400).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  const tokenScope = authCode.scope || 'openid';

  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, tenant_id: user.tenant_id },
    config.JWT_SECRET,
    { expiresIn: '24h' }
  );
  const accessExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, scope) VALUES (?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), accessToken, client_id, user.id, accessExpiresAt, tokenScope
  );

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), refreshToken, user.id, client_id, refreshExpiresAt
  );

  const idTokenPayload: Record<string, any> = {
    iss: config.APP_URL,
    sub: user.id,
    aud: client_id,
    exp: Math.floor(Date.now() / 1000) + (60 * 60),
    iat: Math.floor(Date.now() / 1000),
  };
  if (authCode.nonce) idTokenPayload.nonce = authCode.nonce;
  if (tokenScope.includes('email')) idTokenPayload.email = user.email;
  if (tokenScope.includes('profile')) {
    idTokenPayload.name = user.full_name || user.username;
    idTokenPayload.preferred_username = user.username;
  }
  const idToken = jwt.sign(idTokenPayload, config.JWT_SECRET);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: 86400,
    id_token: idToken,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      tenant_id: user.tenant_id,
    },
  });
});

// GET /api/oidc/userinfo
router.get('/userinfo', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json(error('Missing authorization token', ErrorCode.AUTH_UNAUTHORIZED));

  const accessToken: any = db.prepare('SELECT * FROM access_tokens WHERE token = ? AND revoked = 0').get(token);
  if (!accessToken || new Date(accessToken.expires_at) < new Date()) return res.status(401).json(error('Invalid or expired access token', ErrorCode.TOKEN_EXPIRED));

  const user: any = db.prepare('SELECT id, username, email, full_name, avatar_url FROM users WHERE id = ?').get(accessToken.user_id);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  const scope: string = accessToken.scope || 'openid';
  const response: Record<string, any> = { sub: user.id };

  if (scope.includes('email')) response.email = user.email;
  if (scope.includes('profile')) {
    response.name = user.full_name || user.username;
    response.preferred_username = user.username;
    response.username = user.username;
    if (user.avatar_url) response.picture = user.avatar_url;
  }

  res.json(response);
});

export default router;
