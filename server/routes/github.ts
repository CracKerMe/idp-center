import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../database.js';
import { config } from '../config.js';
import { logAudit } from '../utils/audit.js';
import { AuditAction } from '../utils/audit-actions.js';
import { generateOAuthState } from '../services/crypto.js';
import { findOrLinkUser } from '../services/identity-link.service.js';
import { success, error, ErrorCode } from '../utils/response.js';
import { users, oauthStates, accessTokens, sessions, refreshTokens, authCodes } from '../schema.js';
import { eq, and, lt, desc } from 'drizzle-orm';

const router = express.Router();

interface GitHubIdentity {
  id: number;
  login: string;
  email: string | null;
  avatar_url: string;
  name: string | null;
}

async function exchangeGitHubCode(code: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) throw new Error(`GitHub token exchange failed: ${response.status}`);

  const data = await response.json() as any;
  if (data.error) throw new Error(`GitHub token exchange error: ${data.error_description || data.error}`);
  if (!data.access_token) throw new Error('GitHub token exchange returned no access_token');

  return data.access_token as string;
}

async function getGitHubUser(accessToken: string): Promise<GitHubIdentity> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) throw new Error(`GitHub user API failed: ${response.status}`);

  const data = await response.json() as any;
  return { id: data.id, login: data.login, email: data.email ?? null, avatar_url: data.avatar_url, name: data.name ?? null };
}

async function getGitHubEmails(accessToken: string): Promise<string | null> {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) throw new Error(`GitHub emails API failed: ${response.status}`);

  const emails = await response.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
  const primary = emails.find(e => e.primary && e.verified);
  return primary ? primary.email : null;
}

async function findOrCreateUserFromGitHub(tenantId: string, identity: GitHubIdentity, accessToken: string) {
  return findOrLinkUser(tenantId, 'github', String(identity.id), {
    email: identity.email,
    emailVerified: !!identity.email, // getGitHubEmails() only ever returns a verified primary address
    username: identity.login,
    displayName: identity.name,
    avatarUrl: identity.avatar_url,
  }, {
    linkByVerifiedEmail: true,
    providerAccessToken: accessToken,
  });
}

// GET /api/auth/github/config
router.get('/config', (req, res) => {
  const enabled = !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);
  res.json(success({ enabled }));
});

// GET /api/auth/github — initiate authorization
router.get('/', async (req, res) => {
  const clientId = config.GITHUB_CLIENT_ID;
  const clientSecret = config.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(503).json(error('GitHub OAuth is not configured', ErrorCode.SERVICE_UNAVAILABLE));
  }

  const callbackUrl = config.GITHUB_CALLBACK_URL || 'http://localhost:5986/api/auth/github/callback';

  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));

  const state = generateOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  // GitHub's callback URL is fixed and carries none of our own query params, so the
  // tenant this login started from has to round-trip through the state row instead.
  await db.insert(oauthStates).values({ state, expiresAt, provider: 'github', payload: JSON.stringify({ tenantId: req.tenantId }) });

  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('scope', 'read:user user:email');
  authUrl.searchParams.set('state', state);

  return res.redirect(302, authUrl.toString());
});

// GET /api/auth/github/callback
router.get('/callback', async (req, res) => {
  const { code, state, error: githubError } = req.query as Record<string, string>;

  if (!code || !state) {
    return res.redirect(302, `/#/login?error=${encodeURIComponent('Missing GitHub callback parameters')}`);
  }

  if (githubError) {
    const errorDesc = githubError === 'access_denied' ? 'GitHub authorization was cancelled' : githubError;
    await logAudit({ req, action: AuditAction.GITHUB_LOGIN_FAILED, details: `GitHub error: ${githubError}` });
    return res.redirect(302, `/#/login?error=${encodeURIComponent(errorDesc)}`);
  }

  const [stateRecord] = await db
    .select({ state: oauthStates.state, expiresAt: oauthStates.expiresAt, payload: oauthStates.payload })
    .from(oauthStates)
    .where(eq(oauthStates.state, state))
    .limit(1);

  if (!stateRecord || stateRecord.expiresAt < new Date()) {
    if (stateRecord) await db.delete(oauthStates).where(eq(oauthStates.state, state));
    return res.status(400).json(error('Invalid or expired OAuth state', ErrorCode.TOKEN_INVALID));
  }

  await db.delete(oauthStates).where(eq(oauthStates.state, state));

  const tenantId: string = (() => {
    try { return JSON.parse(stateRecord.payload || '{}').tenantId || 'default'; } catch { return 'default'; }
  })();

  let githubAccessToken: string;
  try {
    githubAccessToken = await exchangeGitHubCode(code);
  } catch (err: any) {
    await logAudit({ req, action: AuditAction.GITHUB_LOGIN_FAILED, details: `Token exchange failed: ${err.message}` });
    return res.redirect(302, `/#/login?error=${encodeURIComponent('Failed to exchange GitHub authorization code')}`);
  }

  let identity: GitHubIdentity;
  try {
    identity = await getGitHubUser(githubAccessToken);
    const verifiedEmail = await getGitHubEmails(githubAccessToken);
    if (verifiedEmail) identity = { ...identity, email: verifiedEmail };
  } catch (err: any) {
    await logAudit({ req, action: AuditAction.GITHUB_LOGIN_FAILED, details: `GitHub user info failed: ${err.message}` });
    return res.redirect(302, `/#/login?error=${encodeURIComponent('Failed to retrieve GitHub user information')}`);
  }

  let user: any;
  try {
    user = await findOrCreateUserFromGitHub(tenantId, identity, githubAccessToken);
  } catch (err: any) {
    await logAudit({ req, action: AuditAction.GITHUB_LOGIN_FAILED, details: `Account linking failed: ${err.message}` });
    return res.redirect(302, `/#/login?error=${encodeURIComponent('Failed to complete GitHub login')}`);
  }

  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.isAdmin, tenant_id: user.tenantId },
    config.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token: accessToken,
    clientId: 'system',
    userId: user.id,
    tenantId: user.tenantId || 'default',
    expiresAt: accessExpiresAt,
  });

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const sessionId = crypto.randomUUID();
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    deviceInfo: userAgent,
    ipAddress: ip,
  });

  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    token: refreshToken,
    userId: user.id,
    clientId: null,
    expiresAt: refreshExpiresAt,
  });

  await logAudit({ req, action: AuditAction.GITHUB_LOGIN_SUCCESS, userId: user.id, details: `GitHub username: ${identity.login}` });

  const exchangeCode = crypto.randomBytes(32).toString('hex');
  const exchangeExpiresAt = new Date(Date.now() + 60 * 1000);
  await db.insert(authCodes).values({
    id: crypto.randomUUID(),
    code: exchangeCode,
    clientId: 'github-oauth',
    userId: user.id,
    redirectUri: '/',
    expiresAt: exchangeExpiresAt,
    scope: 'github_login',
  });

  return res.redirect(302, `/#/?github_code=${encodeURIComponent(exchangeCode)}&session_id=${encodeURIComponent(sessionId)}`);
});

// POST /api/auth/github/exchange
router.post('/exchange', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json(error('Code required', ErrorCode.VALIDATION_REQUIRED));

  const [authCode] = await db
    .select()
    .from(authCodes)
    .where(and(eq(authCodes.code, code), eq(authCodes.clientId, 'github-oauth'), eq(authCodes.scope, 'github_login')))
    .limit(1);
  if (!authCode) return res.status(401).json(error('Invalid code', ErrorCode.TOKEN_INVALID));

  await db.delete(authCodes).where(eq(authCodes.id, authCode.id));

  if (authCode.expiresAt < new Date()) return res.status(401).json(error('Code expired', ErrorCode.TOKEN_EXPIRED));

  const [accessTokenRecord] = await db
    .select({ token: accessTokens.token })
    .from(accessTokens)
    .where(and(eq(accessTokens.userId, authCode.userId), eq(accessTokens.revoked, false)))
    .orderBy(desc(accessTokens.createdAt))
    .limit(1);

  const [refreshTokenRecord] = await db
    .select({ token: refreshTokens.token })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, authCode.userId), eq(refreshTokens.revoked, false)))
    .orderBy(desc(refreshTokens.createdAt))
    .limit(1);

  if (!accessTokenRecord || !refreshTokenRecord) return res.status(500).json(error('Token generation failed', ErrorCode.SERVER_ERROR));

  const [user] = await db
    .select({ id: users.id, username: users.username, email: users.email, isAdmin: users.isAdmin, otpEnabled: users.otpEnabled, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, authCode.userId))
    .limit(1);

  res.json(success({
    access_token: accessTokenRecord.token,
    refresh_token: refreshTokenRecord.token,
    token_type: 'Bearer',
    user,
  }));
});

export default router;
