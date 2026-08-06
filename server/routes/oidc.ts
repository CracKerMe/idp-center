import express from 'express';
import crypto from 'crypto';
import { db } from '../database.js';
import { config } from '../config.js';
import { logAudit } from '../utils/audit.js';
import { generateOAuthState } from '../services/crypto.js';
import { authenticateToken } from '../middleware/auth.js';
import { success, error, ErrorCode } from '../utils/response.js';
import { clients, authCodes, accessTokens, users, oauthStates, deviceCodes, oidcSessions, sessions } from '../schema.js';
import { eq, and, lt, gt, isNull } from 'drizzle-orm';
import { grantRegistry } from '../oauth/registry.js';
import { authenticateClient, parseList } from '../oauth/client-auth.js';
import { OAuthError, sendOAuthError } from '../oauth/errors.js';
import { handleIntrospect } from '../oauth/introspect.js';
import { handleRevoke } from '../oauth/revoke.js';
import { getOrCreateOidcSession } from '../oauth/sessions.js';
import { verifyInternalJwt } from '../oauth/jwt.js';
import { revokeTokensBySession } from '../utils/token-blacklist.js';
import { enqueueBackchannelLogout } from '../services/backchannel-logout.service.js';
import { handlePar, peekPar, resolvePar, PAR_REQUEST_URI_PREFIX } from '../oauth/par.js';
import { handleRegister, handleRegistrationRead, handleRegistrationUpdate, handleRegistrationDelete } from '../oauth/dynamic-registration.js';

const router = express.Router();

const SUPPORTED_CODE_CHALLENGE_METHODS = new Set(['S256', 'plain']);

// Consonants only (no vowels, no 0/O/1/I) — avoids accidentally spelling words
// and characters that are easy to misread when a user types the code by hand.
const USER_CODE_CHARSET = 'BCDFGHJKLMNPQRSTVWXZ';

function generateUserCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += USER_CODE_CHARSET[crypto.randomInt(USER_CODE_CHARSET.length)];
  }
  return code;
}

function normalizeUserCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// GET /api/oidc/authorize
router.get('/authorize', async (req, res) => {
  const { client_id, request_uri } = req.query;
  let { redirect_uri, scope } = req.query;
  const tenantId = req.tenantId;

  // RFC 9126: a pushed request_uri stands in for the params it was pushed with —
  // peek (non-consuming) here since this GET is only rendering the consent screen;
  // the real single-use redemption happens in POST /authorize below.
  if (typeof request_uri === 'string' && request_uri.startsWith(PAR_REQUEST_URI_PREFIX)) {
    if (typeof client_id !== 'string') return res.status(400).json(error('client_id is required alongside request_uri', ErrorCode.VALIDATION_ERROR));
    const par = await peekPar(request_uri, client_id, tenantId);
    if (!par) return res.status(400).json(error('Invalid or expired request_uri', ErrorCode.VALIDATION_ERROR));
    if (par.redirect_uri) redirect_uri = par.redirect_uri;
    if (par.scope) scope = par.scope;
  }

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
  const { client_id } = req.body;
  let { redirect_uri, response_type, nonce, scope, code_challenge, code_challenge_method } = req.body;
  const userId = req.user!.id;
  const tenantId = req.tenantId;

  // RFC 9126: request_uri fully determines the authorization request — its stored
  // payload overrides whatever the caller also passed alongside it. Single-use:
  // resolvePar() atomically marks the row consumed, so a replayed request_uri fails.
  if (typeof req.body?.request_uri === 'string' && req.body.request_uri.startsWith(PAR_REQUEST_URI_PREFIX)) {
    if (typeof client_id !== 'string') return res.status(400).json(error('client_id is required alongside request_uri', ErrorCode.VALIDATION_ERROR));
    const par = await resolvePar(req.body.request_uri, client_id, tenantId);
    if (!par) return res.status(400).json(error('Invalid or expired request_uri', ErrorCode.VALIDATION_ERROR));
    redirect_uri = par.redirect_uri ?? redirect_uri;
    response_type = par.response_type ?? response_type;
    nonce = par.nonce ?? nonce;
    scope = par.scope ?? scope;
    code_challenge = par.code_challenge ?? code_challenge;
    code_challenge_method = par.code_challenge_method ?? code_challenge_method;
  }

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

  const challengeMethod = code_challenge_method || 'S256';
  if (code_challenge && !SUPPORTED_CODE_CHALLENGE_METHODS.has(challengeMethod)) {
    return res.status(400).json(error('Unsupported code_challenge_method', ErrorCode.VALIDATION_ERROR));
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

  // Falls back to the user id when the bearer token has no bsid (e.g. minted by
  // /api/auth/refresh, which doesn't carry one yet) — degrades to per-user rather
  // than per-browser session grouping for back-channel logout in that edge case,
  // but never leaves the OIDC session unlinked.
  const browserSessionId = (req.user as any)?.bsid || userId;
  const oidcSession = await getOrCreateOidcSession({ browserSessionId, userId, clientId: client_id, tenantId, scope: authScope });

  await db.insert(authCodes).values({
    id: crypto.randomUUID(),
    code,
    clientId: client_id,
    userId: userId,
    tenantId,
    redirectUri: redirect_uri,
    expiresAt,
    nonce: nonce || null,
    scope: authScope,
    codeChallenge: code_challenge || null,
    codeChallengeMethod: challengeMethod,
    sid: oidcSession.sid,
  });

  await logAudit(userId, 'OAUTH_AUTHORIZE', req, `Authorized client ${client_id}`, tenantId);

  const redirectUrl = new URL(redirect_uri as string);
  redirectUrl.searchParams.append('code', code);
  redirectUrl.searchParams.append('state', state);

  res.json(success({ redirect_url: redirectUrl.toString() }));
});

// POST /api/oidc/token
router.post('/token', async (req, res) => {
  try {
    const grantType = req.body?.grant_type;
    if (!grantType) throw new OAuthError('invalid_request', 400, 'grant_type is required');

    const handler = grantRegistry[grantType];
    if (!handler) throw new OAuthError('unsupported_grant_type', 400);

    const client = await authenticateClient(req);

    if (!client.grantTypes.includes(grantType)) {
      if (config.OAUTH_ENFORCE_GRANT_TYPES) {
        throw new OAuthError('unauthorized_client', 400, `Client is not authorized for grant_type ${grantType}`);
      }
      console.warn(`[oauth] client ${client.clientId} used grant_type "${grantType}" not declared in its grant_types (warn-only)`);
    }

    const result = await handler.handle({
      req,
      res,
      params: req.body,
      client,
      tenantId: client.tenantId,
      grantType,
      now: new Date(),
    });

    res.json(result);
  } catch (err) {
    sendOAuthError(res, err);
  }
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

// POST /api/oidc/introspect
router.post('/introspect', handleIntrospect);

// POST /api/oidc/revoke
router.post('/revoke', handleRevoke);

// POST /api/oidc/par — RFC 9126 Pushed Authorization Requests
router.post('/par', handlePar);

// RFC 7591/7592 dynamic client registration — gated per-tenant, see dynamic-registration.ts
router.post('/register', handleRegister);
router.get('/register/:client_id', handleRegistrationRead);
router.put('/register/:client_id', handleRegistrationUpdate);
router.delete('/register/:client_id', handleRegistrationDelete);

// POST /api/oidc/device_authorization
router.post('/device_authorization', async (req, res) => {
  try {
    const client = await authenticateClient(req);
    const scope = typeof req.body?.scope === 'string' && req.body.scope.trim() ? req.body.scope.trim() : 'openid';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const deviceCode = crypto.randomBytes(32).toString('hex');
    let userCode = '';
    let inserted = false;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      userCode = generateUserCode();
      try {
        await db.insert(deviceCodes).values({
          id: crypto.randomUUID(),
          deviceCode,
          userCode,
          clientId: client.clientId,
          tenantId: client.tenantId,
          scope,
          expiresAt,
          interval: 5,
        });
        inserted = true;
      } catch (err) {
        lastErr = err; // user_code collision within the tenant — retry with a fresh code
      }
    }
    if (!inserted) throw lastErr;

    const issuer = config.APP_URL;
    const formattedCode = formatUserCode(userCode);
    res.json({
      device_code: deviceCode,
      user_code: formattedCode,
      // The frontend is a hash-routed SPA (createHashHistory) — the fragment never
      // reaches the server, so /#/device is resolved client-side, not redirected here.
      verification_uri: `${issuer}/#/device`,
      verification_uri_complete: `${issuer}/#/device?user_code=${encodeURIComponent(formattedCode)}`,
      expires_in: 600,
      interval: 5,
    });
  } catch (err) {
    sendOAuthError(res, err);
  }
});

// GET /api/oidc/device/verify
router.get('/device/verify', authenticateToken, async (req, res) => {
  const userCode = normalizeUserCode(typeof req.query.user_code === 'string' ? req.query.user_code : '');
  const tenantId = req.tenantId;

  const [row] = await db
    .select()
    .from(deviceCodes)
    .where(and(eq(deviceCodes.userCode, userCode), eq(deviceCodes.tenantId, tenantId), eq(deviceCodes.status, 'pending')))
    .limit(1);

  if (!row || row.expiresAt < new Date()) {
    return res.status(404).json(error('Invalid or expired user_code', ErrorCode.RESOURCE_NOT_FOUND));
  }

  const [client] = await db.select({ clientName: clients.clientName }).from(clients).where(eq(clients.clientId, row.clientId)).limit(1);
  res.json(success({ client_name: client?.clientName || row.clientId, scope: row.scope }));
});

// POST /api/oidc/device/approve
router.post('/device/approve', authenticateToken, async (req, res) => {
  const userCode = normalizeUserCode(req.body?.user_code || '');
  const tenantId = req.tenantId;

  const [updated] = await db
    .update(deviceCodes)
    .set({ status: 'approved', userId: req.user!.id, approvedAt: new Date() })
    .where(and(eq(deviceCodes.userCode, userCode), eq(deviceCodes.tenantId, tenantId), eq(deviceCodes.status, 'pending'), gt(deviceCodes.expiresAt, new Date())))
    .returning();

  if (!updated) {
    return res.status(404).json(error('Invalid or expired user_code', ErrorCode.RESOURCE_NOT_FOUND));
  }

  await logAudit(req.user!.id, 'OAUTH_DEVICE_APPROVE', req, `Approved device code for client ${updated.clientId}`, tenantId);
  res.json(success({ approved: true }));
});

// POST /api/oidc/device/deny
router.post('/device/deny', authenticateToken, async (req, res) => {
  const userCode = normalizeUserCode(req.body?.user_code || '');
  const tenantId = req.tenantId;

  const [updated] = await db
    .update(deviceCodes)
    .set({ status: 'denied' })
    .where(and(eq(deviceCodes.userCode, userCode), eq(deviceCodes.tenantId, tenantId), eq(deviceCodes.status, 'pending'), gt(deviceCodes.expiresAt, new Date())))
    .returning();

  if (!updated) {
    return res.status(404).json(error('Invalid or expired user_code', ErrorCode.RESOURCE_NOT_FOUND));
  }

  await logAudit(req.user!.id, 'OAUTH_DEVICE_DENY', req, `Denied device code for client ${updated.clientId}`, tenantId);
  res.json(success({ denied: true }));
});

// GET|POST /api/oidc/end_session — RP-initiated logout (OpenID Connect RP-Initiated Logout 1.0).
// Always redirects to the hash-routed confirmation page; the id_token_hint's signature is the
// only thing that authorizes acting on its sid/aud, and it's expected to be expired by now.
router.all('/end_session', async (req, res) => {
  const params: Record<string, unknown> = req.method === 'GET' ? req.query : req.body;
  const idTokenHint = typeof params.id_token_hint === 'string' ? params.id_token_hint : undefined;
  const requestedRedirect = typeof params.post_logout_redirect_uri === 'string' ? params.post_logout_redirect_uri : undefined;
  const state = typeof params.state === 'string' ? params.state : undefined;

  let sid: string | undefined;
  let clientId: string | undefined;
  let validatedRedirect: string | undefined;

  if (idTokenHint) {
    try {
      const payload = await verifyInternalJwt(idTokenHint, { ignoreExpiration: true });
      sid = typeof payload.sid === 'string' ? payload.sid : undefined;
      clientId = typeof payload.aud === 'string' ? payload.aud : undefined;

      if (clientId && requestedRedirect) {
        const [client] = await db.select({ postLogoutRedirectUris: clients.postLogoutRedirectUris }).from(clients).where(eq(clients.clientId, clientId)).limit(1);
        if (parseList(client?.postLogoutRedirectUris).includes(requestedRedirect)) {
          validatedRedirect = requestedRedirect;
        }
      }
    } catch {
      // Invalid/unverifiable id_token_hint — fall through to a bare confirmation page, no redirect target.
    }
  }

  const target = new URL(`${config.APP_URL}/#/logout`);
  if (sid) target.searchParams.set('sid', sid);
  if (clientId) target.searchParams.set('client_id', clientId);
  if (validatedRedirect) target.searchParams.set('post_logout_redirect_uri', validatedRedirect);
  if (state) target.searchParams.set('state', state);

  res.redirect(target.toString());
});

// POST /api/oidc/end_session/confirm — terminates the whole browser SSO session,
// not just the client that started the logout, and fans out front/back-channel logout.
router.post('/end_session/confirm', authenticateToken, async (req, res) => {
  const tenantId = req.tenantId;
  const browserSessionId = (req.user as any)?.bsid || req.user!.id;

  const liveSessions = await db
    .select()
    .from(oidcSessions)
    .where(and(eq(oidcSessions.browserSessionId, browserSessionId), eq(oidcSessions.tenantId, tenantId), isNull(oidcSessions.terminatedAt)));

  const frontChannelLogoutUris: string[] = [];
  const now = new Date();

  for (const session of liveSessions) {
    await db.update(oidcSessions).set({ terminatedAt: now }).where(eq(oidcSessions.id, session.id));
    await revokeTokensBySession(session.id);

    const [client] = await db
      .select({ frontchannelLogoutUri: clients.frontchannelLogoutUri })
      .from(clients)
      .where(eq(clients.clientId, session.clientId))
      .limit(1);

    if (client?.frontchannelLogoutUri) {
      const uri = new URL(client.frontchannelLogoutUri);
      uri.searchParams.set('iss', config.APP_URL);
      uri.searchParams.set('sid', session.sid);
      frontChannelLogoutUris.push(uri.toString());
    }

    await enqueueBackchannelLogout(session);
  }

  await db.delete(sessions).where(and(eq(sessions.id, browserSessionId), eq(sessions.userId, req.user!.id)));

  await logAudit(req.user!.id, 'OAUTH_END_SESSION', req, `Terminated ${liveSessions.length} OIDC session(s)`, tenantId);

  const postLogoutRedirectUri = typeof req.body?.post_logout_redirect_uri === 'string' ? req.body.post_logout_redirect_uri : null;
  res.json(success({ front_channel_logout_uris: frontChannelLogoutUris, post_logout_redirect_uri: postLogoutRedirectUri }));
});

export default router;
