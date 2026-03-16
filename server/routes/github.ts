import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../database.js';
import { config } from '../config.js';
import { logAudit } from '../utils/audit.js';
import { encryptToken, generateOAuthState } from '../services/crypto.js';

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

function findOrCreateUserFromGitHub(identity: GitHubIdentity, accessToken: string): any {
  const providerUserId = String(identity.id);
  const encryptedToken = encryptToken(accessToken);
  const now = new Date().toISOString();

  const existingLink = db.prepare(
    'SELECT la.*, u.* FROM linked_accounts la JOIN users u ON la.user_id = u.id WHERE la.provider = ? AND la.provider_user_id = ?'
  ).get('github', providerUserId) as any;

  if (existingLink) {
    db.prepare(
      'UPDATE linked_accounts SET provider_username = ?, access_token = ?, updated_at = ? WHERE provider = ? AND provider_user_id = ?'
    ).run(identity.login, encryptedToken, now, 'github', providerUserId);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existingLink.user_id) as any;
  }

  if (identity.email) {
    const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(identity.email) as any;
    if (userByEmail) {
      db.prepare(
        'INSERT INTO linked_accounts (id, user_id, provider, provider_user_id, provider_username, access_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), userByEmail.id, 'github', providerUserId, identity.login, encryptedToken, now, now);
      return userByEmail;
    }
  }

  let username = identity.login;
  const usernameConflict = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (usernameConflict) {
    username = `${username}_${crypto.randomBytes(2).toString('hex')}`;
  }

  const placeholderPasswordHash = bcrypt.hashSync('', 10);
  const newUserId = crypto.randomUUID();

  db.prepare(
    'INSERT INTO users (id, username, email, password_hash, is_active, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, ?, ?)'
  ).run(newUserId, username, identity.email ?? null, placeholderPasswordHash, now, now);

  db.prepare(
    'INSERT INTO linked_accounts (id, user_id, provider, provider_user_id, provider_username, access_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), newUserId, 'github', providerUserId, identity.login, encryptedToken, now, now);

  return db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId) as any;
}

// GET /api/auth/github/config
router.get('/config', (req, res) => {
  const enabled = !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);
  res.json({ enabled });
});

// GET /api/auth/github — initiate authorization
router.get('/', (req, res) => {
  const clientId = config.GITHUB_CLIENT_ID;
  const clientSecret = config.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(503).json({ error: 'GitHub OAuth is not configured', code: 'GITHUB_NOT_CONFIGURED' });
  }

  const callbackUrl = config.GITHUB_CALLBACK_URL || 'http://localhost:5986/api/auth/github/callback';

  db.prepare('DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP').run();

  const state = generateOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)').run(state, expiresAt);

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

  if (githubError) {
    const errorDesc = githubError === 'access_denied' ? 'GitHub authorization was cancelled' : githubError;
    logAudit(null, 'GITHUB_LOGIN_FAILED', req, `GitHub error: ${githubError}`);
    return res.redirect(302, `/login?error=${encodeURIComponent(errorDesc)}`);
  }

  const stateRecord = db.prepare(
    'SELECT state, expires_at FROM oauth_states WHERE state = ?'
  ).get(state) as { state: string; expires_at: string } | undefined;

  if (!stateRecord || new Date(stateRecord.expires_at) < new Date()) {
    if (stateRecord) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    return res.status(400).json({ error: 'Invalid or expired OAuth state' });
  }

  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

  let githubAccessToken: string;
  try {
    githubAccessToken = await exchangeGitHubCode(code);
  } catch (err: any) {
    logAudit(null, 'GITHUB_LOGIN_FAILED', req, `Token exchange failed: ${err.message}`);
    return res.redirect(302, `/login?error=${encodeURIComponent('Failed to exchange GitHub authorization code')}`);
  }

  let identity: GitHubIdentity;
  try {
    identity = await getGitHubUser(githubAccessToken);
    const verifiedEmail = await getGitHubEmails(githubAccessToken);
    if (verifiedEmail) identity = { ...identity, email: verifiedEmail };
  } catch (err: any) {
    logAudit(null, 'GITHUB_LOGIN_FAILED', req, `GitHub user info failed: ${err.message}`);
    return res.redirect(302, `/login?error=${encodeURIComponent('Failed to retrieve GitHub user information')}`);
  }

  let user: any;
  try {
    user = findOrCreateUserFromGitHub(identity, githubAccessToken);
  } catch (err: any) {
    logAudit(null, 'GITHUB_LOGIN_FAILED', req, `Account linking failed: ${err.message}`);
    return res.redirect(302, `/login?error=${encodeURIComponent('Failed to complete GitHub login')}`);
  }

  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, tenant_id: user.tenant_id },
    config.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO access_tokens (id, token, client_id, user_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), accessToken, 'system', user.id, accessExpiresAt
  );

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const sessionId = crypto.randomUUID();
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  db.prepare('INSERT INTO sessions (id, user_id, device_info, ip_address) VALUES (?, ?, ?, ?)').run(
    sessionId, user.id, userAgent, ip
  );

  db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), refreshToken, user.id, null, refreshExpiresAt
  );

  logAudit(user.id, 'GITHUB_LOGIN_SUCCESS', req, `GitHub username: ${identity.login}`);

  const exchangeCode = crypto.randomBytes(32).toString('hex');
  const exchangeExpiresAt = new Date(Date.now() + 60 * 1000).toISOString();
  db.prepare('INSERT INTO auth_codes (id, code, client_id, user_id, redirect_uri, expires_at, scope) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), exchangeCode, 'github-oauth', user.id, '/', exchangeExpiresAt, 'github_login'
  );

  db.prepare('INSERT INTO access_tokens (id, token, client_id, user_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), accessToken, 'system', user.id, accessExpiresAt
  );
  db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), refreshToken, user.id, null, refreshExpiresAt
  );

  return res.redirect(302, `/?github_code=${encodeURIComponent(exchangeCode)}&session_id=${encodeURIComponent(sessionId)}`);
});

// POST /api/auth/github/exchange
router.post('/exchange', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  const authCode: any = db.prepare("SELECT * FROM auth_codes WHERE code = ? AND client_id = 'github-oauth' AND scope = 'github_login'").get(code);
  if (!authCode) return res.status(401).json({ error: 'Invalid code' });

  db.prepare('DELETE FROM auth_codes WHERE id = ?').run(authCode.id);

  if (new Date(authCode.expires_at) < new Date()) return res.status(401).json({ error: 'Code expired' });

  const accessToken: any = db.prepare("SELECT token FROM access_tokens WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1").get(authCode.user_id);
  const refreshToken: any = db.prepare("SELECT token FROM refresh_tokens WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1").get(authCode.user_id);

  if (!accessToken || !refreshToken) return res.status(500).json({ error: 'Token generation failed' });

  const user: any = db.prepare('SELECT id, username, email, is_admin, otp_enabled, tenant_id FROM users WHERE id = ?').get(authCode.user_id);

  res.json({
    access_token: accessToken.token,
    refresh_token: refreshToken.token,
    token_type: 'Bearer',
    user,
  });
});

export default router;
