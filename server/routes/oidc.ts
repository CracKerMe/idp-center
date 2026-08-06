import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../database.js';
import { config, TOKEN_CONFIG } from '../config.js';
import { logAudit } from '../utils/audit.js';
import { generateOAuthState } from '../services/crypto.js';
import { authenticateToken } from '../middleware/auth.js';
import { success, error, ErrorCode } from '../utils/response.js';
import { clients, authCodes, accessTokens, refreshTokens, users, oauthStates } from '../schema.js';
import { eq, and, lt } from 'drizzle-orm';
import type { Client, AuthCode, RefreshToken, AccessToken } from '../types/index.js';

const router = express.Router();

// GET /api/oidc/authorize
router.get('/authorize', async (req, res) => {
  const { client_id, redirect_uri, scope } = req.query;
  const tenantId = req.tenantId;

  const [client] = await db.select().from(clients).where(and(eq(clients.clientId, client_id as string), eq(clients.tenantId, tenantId))).limit(1);
  if (!client) return res.status(400).json(error('Invalid client_id for this tenant', ErrorCode.VALIDATION_ERROR));

  const rawUris = client.redirectUris || '';
  const registeredUris: string[] = rawUris.startsWith('[')
    ? JSON.parse(rawUris)
    : rawUris.split(',').map((u: string) => u.trim()).filter(Boolean);
  if (!redirect_uri || !registeredUris.includes(redirect_uri as string)) {
    return res.status(400).json(error('Invalid redirect_uri', ErrorCode.VALIDATION_ERROR));
  }

  res.json(success({ client_name: client.clientName, scopes: scope }));
});

// POST /api/oidc/authorize
router.post('/authorize', authenticateToken, async (req, res) => {
  const { client_id, redirect_uri, response_type, nonce, scope, code_challenge, code_challenge_method } = req.body;
  const userId = req.user!.id;
  const tenantId = req.tenantId;

  if (response_type !== 'code') return res.status(400).json(error('Unsupported response_type', ErrorCode.VALIDATION_ERROR));

  const [client] = await db.select().from(clients).where(and(eq(clients.clientId, client_id), eq(clients.tenantId, tenantId))).limit(1);
  if (!client) return res.status(400).json(error('Invalid client_id for this tenant', ErrorCode.VALIDATION_ERROR));

  const rawUris = client.redirectUris || '';
  const registeredUris: string[] = rawUris.startsWith('[')
    ? JSON.parse(rawUris)
    : rawUris.split(',').map((u: string) => u.trim()).filter(Boolean);
  if (!redirect_uri || !registeredUris.includes(redirect_uri as string)) {
    return res.status(400).json(error('Invalid redirect_uri', ErrorCode.VALIDATION_ERROR));
  }

  // Generate server-side state for CSRF protection (ignore client-provided state)
  if (Math.random() < 0.1) {
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  }
  const state = generateOAuthState();
  const stateExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(oauthStates).values({ state, expiresAt: stateExpiresAt });

  const code = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60000);
  const authScope = scope || 'openid';
  const challengeMethod = code_challenge_method || 'S256';

  await db.insert(authCodes).values({
    id: crypto.randomUUID(),
    code,
    clientId: client_id,
    userId: userId,
    redirectUri: redirect_uri,
    expiresAt,
    nonce: nonce || null,
    scope: authScope,
    codeChallenge: code_challenge || null,
    codeChallengeMethod: challengeMethod,
  });

  await logAudit(userId, 'OAUTH_AUTHORIZE', req, `Authorized client ${client_id}`, tenantId);

  const redirectUrl = new URL(redirect_uri as string);
  redirectUrl.searchParams.append('code', code);
  redirectUrl.searchParams.append('state', state);

  res.json(success({ redirect_url: redirectUrl.toString() }));
});

// POST /api/oidc/token
router.post('/token', async (req, res) => {
  const { grant_type, code, client_id, client_secret, redirect_uri, code_verifier, refresh_token } = req.body;
  const tenantId = req.tenantId;

  if (grant_type === 'refresh_token') {
    if (!refresh_token) return res.status(400).json(error('refresh_token is required', ErrorCode.VALIDATION_REQUIRED));

    const [client] = await db.select().from(clients).where(and(eq(clients.clientId, client_id), eq(clients.clientSecret, client_secret), eq(clients.tenantId, tenantId))).limit(1);
    if (!client) return res.status(401).json(error('Invalid client credentials for this tenant', ErrorCode.AUTH_INVALID_CREDENTIALS));

    const [rtRecord] = await db.select().from(refreshTokens).where(and(eq(refreshTokens.token, refresh_token), eq(refreshTokens.clientId, client_id), eq(refreshTokens.revoked, false))).limit(1);
    if (!rtRecord || new Date(rtRecord.expiresAt) < new Date()) {
      return res.status(400).json(error('Invalid or expired refresh_token', ErrorCode.TOKEN_INVALID));
    }

    const [user] = await db.select().from(users).where(eq(users.id, rtRecord.userId)).limit(1);
    if (!user) return res.status(400).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));
    if (!user.isActive) return res.status(403).json(error('User account is disabled', ErrorCode.ACCOUNT_DISABLED));

    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, rtRecord.id));
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const refreshExpiresAt = new Date(Date.now() + TOKEN_CONFIG.refreshTokenExpiryMs);
    await db.insert(refreshTokens).values({
      id: crypto.randomUUID(),
      token: newRefreshToken,
      userId: user.id,
      clientId: client_id,
      expiresAt: refreshExpiresAt,
    });

    const newAccessToken = jwt.sign(
      { id: user.id, username: user.username, isAdmin: user.isAdmin, tenantId: user.tenantId, jti: crypto.randomUUID() },
      config.JWT_SECRET,
      { expiresIn: TOKEN_CONFIG.accessTokenExpiry }
    );
    const accessExpiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);
    const tokenScope = 'openid';
    await db.insert(accessTokens).values({
      id: crypto.randomUUID(),
      token: newAccessToken,
      clientId: client_id,
      userId: user.id,
      expiresAt: accessExpiresAt,
      scope: tokenScope,
    });

    const idTokenPayload: Record<string, any> = {
      iss: config.APP_URL,
      sub: user.id,
      aud: client_id,
      exp: Math.floor(Date.now() / 1000) + TOKEN_CONFIG.accessTokenExpirySeconds,
      iat: Math.floor(Date.now() / 1000),
    };
    if (tokenScope.includes('email')) idTokenPayload.email = user.email;
    if (tokenScope.includes('profile')) {
      idTokenPayload.name = user.fullName || user.username;
      idTokenPayload.preferred_username = user.username;
    }
    const newIdToken = jwt.sign(idTokenPayload, config.JWT_SECRET);

    return res.json({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_type: 'Bearer',
      expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
      id_token: newIdToken,
    });
  }

  if (grant_type !== 'authorization_code') return res.status(400).json(error('Unsupported grant_type', ErrorCode.VALIDATION_ERROR));

  const [client] = await db.select().from(clients).where(and(eq(clients.clientId, client_id), eq(clients.clientSecret, client_secret), eq(clients.tenantId, tenantId))).limit(1);
  if (!client) return res.status(401).json(error('Invalid client credentials for this tenant', ErrorCode.AUTH_INVALID_CREDENTIALS));

  const [authCode] = await db.select().from(authCodes).where(and(eq(authCodes.code, code), eq(authCodes.clientId, client_id), eq(authCodes.redirectUri, redirect_uri), eq(authCodes.used, false))).limit(1);
  if (!authCode || new Date(authCode.expiresAt) < new Date()) {
    return res.status(400).json(error('Invalid or expired code', ErrorCode.TOKEN_INVALID));
  }

  if (authCode.codeChallenge) {
    if (!code_verifier) return res.status(400).json(error('code_verifier is required', ErrorCode.VALIDATION_REQUIRED));
    const computedChallenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (computedChallenge !== authCode.codeChallenge) {
      return res.status(400).json(error('Invalid code_verifier', ErrorCode.VALIDATION_ERROR));
    }
  }

  await db.update(authCodes).set({ used: true }).where(eq(authCodes.id, authCode.id));

  const [user] = await db.select().from(users).where(eq(users.id, authCode.userId)).limit(1);
  if (!user) return res.status(400).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  const tokenScope = authCode.scope || 'openid';

  const accessToken = jwt.sign(
    { id: user.id, username: user.username, isAdmin: user.isAdmin, tenantId: user.tenantId, jti: crypto.randomUUID() },
    config.JWT_SECRET,
    { expiresIn: TOKEN_CONFIG.accessTokenExpiry }
  );
  const accessExpiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token: accessToken,
    clientId: client_id,
    userId: user.id,
    expiresAt: accessExpiresAt,
    scope: tokenScope,
  });

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + TOKEN_CONFIG.refreshTokenExpiryDays * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    token: refreshToken,
    userId: user.id,
    clientId: client_id,
    expiresAt: refreshExpiresAt,
  });

  const idTokenPayload: Record<string, any> = {
    iss: config.APP_URL,
    sub: user.id,
    aud: client_id,
    exp: Math.floor(Date.now() / 1000) + TOKEN_CONFIG.accessTokenExpirySeconds,
    iat: Math.floor(Date.now() / 1000),
  };
  if (authCode.nonce) idTokenPayload.nonce = authCode.nonce;
  if (tokenScope.includes('email')) idTokenPayload.email = user.email;
  if (tokenScope.includes('profile')) {
    idTokenPayload.name = user.fullName || user.username;
    idTokenPayload.preferred_username = user.username;
  }
  const idToken = jwt.sign(idTokenPayload, config.JWT_SECRET);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
    id_token: idToken,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.isAdmin,
      tenant_id: user.tenantId,
    },
  });
});

// GET /api/oidc/userinfo
router.get('/userinfo', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json(error('Missing authorization token', ErrorCode.AUTH_UNAUTHORIZED));

  const [accessToken] = await db.select().from(accessTokens).where(and(eq(accessTokens.token, token), eq(accessTokens.revoked, false))).limit(1);
  if (!accessToken || new Date(accessToken.expiresAt) < new Date()) return res.status(401).json(error('Invalid or expired access token', ErrorCode.TOKEN_EXPIRED));

  const [user] = await db.select({
    id: users.id,
    username: users.username,
    email: users.email,
    fullName: users.fullName,
    avatarUrl: users.avatarUrl,
  }).from(users).where(eq(users.id, accessToken.userId)).limit(1);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  const scope: string = accessToken.scope || 'openid';
  const response: Record<string, any> = { sub: user.id };

  if (scope.includes('email')) response.email = user.email;
  if (scope.includes('profile')) {
    response.name = user.fullName || user.username;
    response.preferred_username = user.username;
    response.username = user.username;
    if (user.avatarUrl) response.picture = user.avatarUrl;
  }

  res.json(response);
});

export default router;
