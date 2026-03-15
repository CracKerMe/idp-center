import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 5986;

app.use(express.json());

// Database Setup
const db = new Database('auth.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    is_admin INTEGER DEFAULT 0,
    otp_secret TEXT,
    otp_enabled INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    client_id TEXT UNIQUE NOT NULL,
    client_secret TEXT NOT NULL,
    client_name TEXT NOT NULL,
    redirect_uris TEXT NOT NULL,
    grant_types TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auth_codes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS access_tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    tenant_id TEXT,
    action TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    is_active INTEGER DEFAULT 1,
    settings TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    client_id TEXT,
    expires_at DATETIME NOT NULL,
    revoked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_info TEXT,
    ip_address TEXT,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS linked_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_username TEXT,
    access_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (provider, provider_user_id)
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Database Migration - Add missing columns to existing tables
const migrations = [
  // Users table migrations
  { table: 'users', column: 'tenant_id', sql: 'ALTER TABLE users ADD COLUMN tenant_id TEXT DEFAULT "default"' },
  { table: 'users', column: 'full_name', sql: 'ALTER TABLE users ADD COLUMN full_name TEXT' },
  { table: 'users', column: 'avatar_url', sql: 'ALTER TABLE users ADD COLUMN avatar_url TEXT' },
  { table: 'users', column: 'phone', sql: 'ALTER TABLE users ADD COLUMN phone TEXT' },
  { table: 'users', column: 'password_changed_at', sql: 'ALTER TABLE users ADD COLUMN password_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP' },
  { table: 'users', column: 'failed_login_attempts', sql: 'ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0' },
  { table: 'users', column: 'locked_until', sql: 'ALTER TABLE users ADD COLUMN locked_until DATETIME' },
];

for (const migration of migrations) {
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(${migration.table})`).all() as any[];
    const columnExists = tableInfo.some(col => col.name === migration.column);
    if (!columnExists) {
      db.exec(migration.sql);
      console.log(`Migration: Added column ${migration.column} to ${migration.table}`);
    }
  } catch (err) {
    console.log(`Migration skipped for ${migration.table}.${migration.column}`);
  }
}

// Create indexes if not exist
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_email_tenant ON users(email, tenant_id)');
} catch (err) {
  // Index might already exist
}

// Seed Default Tenant
const tenantExists = db.prepare('SELECT id FROM tenants WHERE id = ?').get('default');
if (!tenantExists) {
  db.prepare('INSERT INTO tenants (id, name, domain, is_active) VALUES (?, ?, ?, ?)').run(
    'default', 'Default Tenant', 'localhost', 1
  );
}

// Seed Admin User
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (id, tenant_id, username, email, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), 'default', 'admin', 'admin@example.com', hash, 1
  );
}

// Seed Default Client
const clientExists = db.prepare('SELECT id FROM clients WHERE client_id = ?').get('default-client');
if (!clientExists) {
  db.prepare('INSERT INTO clients (id, client_id, client_secret, client_name, redirect_uris, grant_types) VALUES (?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), 'default-client', 'secret123', 'Default Client', 'http://localhost:5986/callback,http://localhost:3000/callback', 'authorization_code'
  );
}

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-prod';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'super-secret-refresh-key-change-in-prod';

// --- GitHub OAuth Interfaces ---

interface GitHubIdentity {
  id: number;           // GitHub 用户 ID
  login: string;        // GitHub 用户名
  email: string | null; // 公开邮箱（可能为 null）
  avatar_url: string;
  name: string | null;
}

interface LinkedAccount {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  provider_username: string;
  access_token: string;  // 加密后存储
  created_at: string;
  updated_at: string;
}

// --- GitHub OAuth Helper Functions ---

// Derive a 32-byte AES key: prefer ENCRYPTION_KEY env var, fallback to SHA-256 of JWT_SECRET
function getEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    // Accept hex-encoded 32-byte key or raw string; normalise to 32 bytes via SHA-256
    return crypto.createHash('sha256').update(envKey).digest();
  }
  return crypto.createHash('sha256').update(JWT_SECRET).digest();
}

// Encrypt a plaintext token using AES-256-GCM.
// Returns a colon-delimited string: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// Decrypt a token produced by encryptToken.
function decryptToken(encrypted: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Invalid encrypted token format');
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

// Generate a cryptographically random OAuth state parameter (64 hex chars = 32 bytes entropy).
function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Exchange a GitHub OAuth authorization code for an access token.
async function exchangeGitHubCode(code: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const data = await response.json() as any;
  if (data.error) {
    throw new Error(`GitHub token exchange error: ${data.error_description || data.error}`);
  }
  if (!data.access_token) {
    throw new Error('GitHub token exchange returned no access_token');
  }

  return data.access_token as string;
}

// Fetch the authenticated GitHub user's profile.
async function getGitHubUser(accessToken: string): Promise<GitHubIdentity> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub user API failed: ${response.status}`);
  }

  const data = await response.json() as any;
  return {
    id: data.id,
    login: data.login,
    email: data.email ?? null,
    avatar_url: data.avatar_url,
    name: data.name ?? null,
  };
}

// Fetch the primary verified email from the GitHub user's email list.
// Returns null if no primary+verified email is found.
async function getGitHubEmails(accessToken: string): Promise<string | null> {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub emails API failed: ${response.status}`);
  }

  const emails = await response.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
  const primary = emails.find(e => e.primary && e.verified);
  return primary ? primary.email : null;
}

// Account Linker: find or create a local user from a GitHub identity
function findOrCreateUserFromGitHub(identity: GitHubIdentity, accessToken: string): any {
  const providerUserId = String(identity.id);
  const encryptedToken = encryptToken(accessToken);
  const now = new Date().toISOString();

  // Priority 1: look up by provider_user_id in linked_accounts
  const existingLink = db.prepare(
    'SELECT la.*, u.* FROM linked_accounts la JOIN users u ON la.user_id = u.id WHERE la.provider = ? AND la.provider_user_id = ?'
  ).get('github', providerUserId) as any;

  if (existingLink) {
    // Update the linked account with fresh token and username
    db.prepare(
      'UPDATE linked_accounts SET provider_username = ?, access_token = ?, updated_at = ? WHERE provider = ? AND provider_user_id = ?'
    ).run(identity.login, encryptedToken, now, 'github', providerUserId);

    // Return the associated user
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existingLink.user_id) as any;
  }

  // Priority 2: match by email in users table
  if (identity.email) {
    const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(identity.email) as any;
    if (userByEmail) {
      // Create a new linked_account linking this GitHub identity to the existing user
      db.prepare(
        'INSERT INTO linked_accounts (id, user_id, provider, provider_user_id, provider_username, access_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), userByEmail.id, 'github', providerUserId, identity.login, encryptedToken, now, now);

      return userByEmail;
    }
  }

  // Priority 3: create a new user + linked_account
  let username = identity.login;

  // Resolve username conflicts by appending a 4-char random hex suffix
  const usernameConflict = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (usernameConflict) {
    const suffix = crypto.randomBytes(2).toString('hex'); // 4 hex chars
    username = `${username}_${suffix}`;
  }

  // Use bcrypt hash of empty string as a non-loginable placeholder
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

// Password strength validation
interface PasswordStrength {
  score: number; // 0-4
  valid: boolean;
  errors: string[];
}

function validatePasswordStrength(password: string): PasswordStrength {
  const errors: string[] = [];
  let score = 0;

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  } else {
    score++;
  }

  if (/[a-z]/.test(password)) score++;
  else errors.push('Password must contain lowercase letters');

  if (/[A-Z]/.test(password)) score++;
  else errors.push('Password must contain uppercase letters');

  if (/[0-9]/.test(password)) score++;
  else errors.push('Password must contain numbers');

  if (/[^a-zA-Z0-9]/.test(password)) score++;
  else errors.push('Password must contain special characters');

  return {
    score,
    valid: score >= 3,
    errors: errors.slice(0, 3) // Return max 3 errors
  };
}

// Middleware to log audit with enhanced logging
function logAudit(userId: string | null, action: string, req: express.Request, details: string = '', tenantId: string = 'default') {
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  db.prepare('INSERT INTO audit_logs (id, user_id, tenant_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), userId, tenantId, action, ip, userAgent, details
  );
  
  // Console log for monitoring
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${action} | User: ${userId || 'anonymous'} | IP: ${ip} | ${details}`);
}

// Middleware to authenticate
function authenticateToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    
    // Check if token has been revoked in database
    const tokenRecord: any = db.prepare('SELECT revoked FROM access_tokens WHERE token = ?').get(token);
    if (tokenRecord && tokenRecord.revoked === 1) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }
    
    (req as any).user = user;
    next();
  });
}

function authenticateAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  authenticateToken(req, res, () => {
    const user = (req as any).user;
    if (!user.is_admin) return res.sendStatus(403);
    next();
  });
}

// --- API Routes ---

// Auth
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hash = bcrypt.hashSync(password, 10);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)').run(id, username, email, hash);
    logAudit(id, 'REGISTER', req, `Registered ${username}`);
    res.json({ message: 'User registered successfully' });
  } catch (err: any) {
    res.status(400).json({ error: 'Username or email already exists' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password, otp } = req.body;
  const user: any = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    logAudit(user?.id || null, 'LOGIN_FAILED', req, `Failed login for ${username}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.otp_enabled) {
    if (!otp) {
      return res.status(403).json({ error: 'OTP required', requireOtp: true });
    }
    const isValid = authenticator.check(otp, user.otp_secret);
    if (!isValid) {
      logAudit(user.id, 'LOGIN_FAILED_OTP', req, `Failed OTP for ${username}`);
      return res.status(401).json({ error: 'Invalid OTP' });
    }
  }

  // Generate access token (short-lived, 15 minutes)
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, tenant_id: user.tenant_id },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
  
  // Store access token in database
  const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
  db.prepare('INSERT INTO access_tokens (id, token, client_id, user_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), accessToken, 'system', user.id, accessExpiresAt
  );

  // Generate refresh token (long-lived, 7 days)
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  // Create session
  const sessionId = crypto.randomUUID();
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const deviceInfo = `${userAgent}`;

  db.prepare('INSERT INTO sessions (id, user_id, device_info, ip_address) VALUES (?, ?, ?, ?)').run(
    sessionId, user.id, deviceInfo, ip
  );

  // Store refresh token with session association
  db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), refreshToken, user.id, null, refreshExpiresAt
  );

  logAudit(user.id, 'LOGIN_SUCCESS', req, `Session: ${sessionId}`);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 900, // 15 minutes
    token_type: 'Bearer',
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      otp_enabled: user.otp_enabled,
      tenant_id: user.tenant_id
    },
    session_id: sessionId
  });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user: any = db.prepare('SELECT id, username, email, is_admin, otp_enabled FROM users WHERE id = ?').get((req as any).user.id);
  if (!user) return res.sendStatus(404);
  res.json(user);
});

// Logout - Revoke session and tokens
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const sessionId = req.headers['x-session-id'];
  
  try {
    // Revoke all refresh tokens for this user
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
    
    // Delete session if session_id provided
    if (sessionId) {
      db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
    }
    
    // Revoke all access tokens (mark as revoked)
    db.prepare('UPDATE access_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
    
    logAudit(userId, 'LOGOUT', req, sessionId ? `Session: ${sessionId}` : 'All sessions');
    res.json({ message: 'Logged out successfully' });
  } catch (err: any) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// OTP
app.post('/api/auth/otp/setup', authenticateToken, async (req, res) => {
  const userId = (req as any).user.id;
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user.username, 'IdP Center', secret);
  
  db.prepare('UPDATE users SET otp_secret = ? WHERE id = ?').run(secret, userId);
  
  const qrCodeUrl = await qrcode.toDataURL(otpauth);
  res.json({ secret, qrCodeUrl });
});

app.post('/api/auth/otp/verify', authenticateToken, (req, res) => {
  const { token } = req.body;
  const userId = (req as any).user.id;
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  
  const isValid = authenticator.check(token, user.otp_secret);
  if (isValid) {
    db.prepare('UPDATE users SET otp_enabled = 1 WHERE id = ?').run(userId);
    logAudit(userId, 'OTP_ENABLED', req);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid OTP' });
  }
});

// OIDC / OAuth 2.1
app.get('/api/oidc/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, state, scope } = req.query;
  
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Invalid client_id' });
  
  // In a real app, we'd check if redirect_uri is in client.redirect_uris
  
  // Render consent screen (this will be handled by frontend, so we just return client info)
  res.json({ client_name: (client as any).client_name, scopes: scope });
});

app.post('/api/oidc/authorize', authenticateToken, (req, res) => {
  const { client_id, redirect_uri, response_type, state } = req.body;
  const userId = (req as any).user.id;
  
  if (response_type !== 'code') return res.status(400).json({ error: 'Unsupported response_type' });
  
  const code = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60000).toISOString(); // 10 mins
  
  db.prepare('INSERT INTO auth_codes (id, code, client_id, user_id, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), code, client_id, userId, redirect_uri, expiresAt
  );
  
  logAudit(userId, 'OAUTH_AUTHORIZE', req, `Authorized client ${client_id}`);
  
  const redirectUrl = new URL(redirect_uri as string);
  redirectUrl.searchParams.append('code', code);
  if (state) redirectUrl.searchParams.append('state', state as string);
  
  res.json({ redirect_url: redirectUrl.toString() });
});

app.post('/api/oidc/token', (req, res) => {
  const { grant_type, code, client_id, client_secret, redirect_uri } = req.body;
  
  if (grant_type !== 'authorization_code') return res.status(400).json({ error: 'Unsupported grant_type' });
  
  const client: any = db.prepare('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?').get(client_id, client_secret);
  if (!client) return res.status(401).json({ error: 'Invalid client credentials' });
  
  const authCode: any = db.prepare('SELECT * FROM auth_codes WHERE code = ? AND client_id = ? AND redirect_uri = ? AND used = 0').get(code, client_id, redirect_uri);
  if (!authCode || new Date(authCode.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }
  
  db.prepare('UPDATE auth_codes SET used = 1 WHERE id = ?').run(authCode.id);
  
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(authCode.user_id);
  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  // Generate JWT access token (same as login, compatible with IDP center)
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, tenant_id: user.tenant_id },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  // Generate refresh token for the OAuth client
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), refreshToken, user.id, client_id, refreshExpiresAt
  );
  
  // Generate ID Token (OIDC)
  const idToken = jwt.sign({
    iss: 'http://localhost:5986',
    sub: user.id,
    aud: client_id,
    exp: Math.floor(Date.now() / 1000) + (60 * 60),
    iat: Math.floor(Date.now() / 1000),
    name: user.username,
    email: user.email
  }, JWT_SECRET);
  
  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: 86400, // 24 hours
    id_token: idToken,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      tenant_id: user.tenant_id
    }
  });
});

app.get('/api/oidc/userinfo', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  
  const accessToken: any = db.prepare('SELECT * FROM access_tokens WHERE token = ? AND revoked = 0').get(token);
  if (!accessToken || new Date(accessToken.expires_at) < new Date()) {
    return res.sendStatus(401);
  }
  
  const user: any = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(accessToken.user_id);
  if (!user) return res.sendStatus(404);
  
  res.json({
    sub: user.id,
    name: user.username,
    email: user.email
  });
});

// Admin Routes
app.get('/api/admin/users', authenticateAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, email, is_active, is_admin, otp_enabled, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
  const { username, email, password, is_admin } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    
    db.prepare('INSERT INTO users (id, username, email, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)').run(
      userId, username, email, password_hash, is_admin ? 1 : 0
    );
    
    logAudit(
      (req as any).user.id,
      'admin_create_user',
      req,
      JSON.stringify({ created_username: username, created_email: email, is_admin })
    );
    
    res.json({ success: true, id: userId });
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/clients', authenticateAdmin, (req, res) => {
  const clients = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  res.json(clients);
});

app.post('/api/admin/clients', authenticateAdmin, (req, res) => {
  const { client_name, redirect_uris } = req.body;
  const client_id = crypto.randomBytes(8).toString('hex');
  const client_secret = crypto.randomBytes(16).toString('hex');
  
  db.prepare('INSERT INTO clients (id, client_id, client_secret, client_name, redirect_uris, grant_types) VALUES (?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), client_id, client_secret, client_name, redirect_uris, 'authorization_code'
  );
  res.json({ success: true });
});

app.get('/api/admin/audit', authenticateAdmin, (req, res) => {
  const logs = db.prepare(`
    SELECT a.*, u.username 
    FROM audit_logs a 
    LEFT JOIN users u ON a.user_id = u.id 
    ORDER BY a.created_at DESC LIMIT 100
  `).all();
  res.json(logs);
});

// --- Enhanced Features ---

// Health Check
app.get('/api/health', (req, res) => {
  const dbOk = db.prepare('SELECT 1').get() !== undefined;
  res.json({
    status: dbOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      database: dbOk ? 'ok' : 'error'
    }
  });
});

// Password Strength Validation API
app.post('/api/auth/password/validate', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }
  const result = validatePasswordStrength(password);
  res.json(result);
});

// Password Reset - Request
app.post('/api/auth/password/reset-request', (req, res) => {
  const { email } = req.body;
  
  const user: any = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    // Don't reveal if email exists
    return res.json({ message: 'If the email exists, a reset link will be sent' });
  }
  
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  
  db.prepare('INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(
    crypto.randomUUID(), user.id, token, expiresAt
  );
  
  logAudit(user.id, 'PASSWORD_RESET_REQUEST', req, `Password reset requested for ${email}`);
  
  // In production, send email with reset link
  // For demo, return the token
  res.json({ 
    message: 'If the email exists, a reset link will be sent',
    reset_token: token // Remove in production
  });
});

// Password Reset - Verify Token
app.post('/api/auth/password/reset-verify', (req, res) => {
  const { token } = req.body;
  
  const reset: any = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(token);
  if (!reset) {
    return res.status(400).json({ error: 'Invalid or used token' });
  }
  
  if (new Date(reset.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Token expired' });
  }
  
  res.json({ valid: true });
});

// Password Reset - Complete
app.post('/api/auth/password/reset', (req, res) => {
  const { token, new_password } = req.body;
  
  // Validate password strength
  const strength = validatePasswordStrength(new_password);
  if (!strength.valid) {
    return res.status(400).json({ error: 'Password does not meet requirements', details: strength.errors });
  }
  
  const reset: any = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(token);
  if (!reset) {
    return res.status(400).json({ error: 'Invalid or used token' });
  }
  
  if (new Date(reset.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Token expired' });
  }
  
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(hash, new Date().toISOString(), reset.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
  
  // Invalidate all refresh tokens for this user
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(reset.user_id);
  
  logAudit(reset.user_id, 'PASSWORD_RESET_COMPLETE', req, 'Password has been reset');
  
  res.json({ message: 'Password has been reset successfully' });
});

// Token Refresh
app.post('/api/auth/refresh', (req, res) => {
  const { refresh_token } = req.body;
  
  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token required' });
  }
  
  const storedToken: any = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0').get(refresh_token);
  if (!storedToken) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
  
  if (new Date(storedToken.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Refresh token expired' });
  }
  
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(storedToken.user_id);
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'User not found or inactive' });
  }
  
  // Generate new access token
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, tenant_id: user.tenant_id },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  // Store new access token in database
  const accessExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  db.prepare('INSERT INTO access_tokens (id, token, client_id, user_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), accessToken, storedToken.client_id || 'system', user.id, accessExpiresAt
  );
  
  // Optionally rotate refresh token
  const newRefreshToken = crypto.randomBytes(32).toString('hex');
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(storedToken.id);
  db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), newRefreshToken, user.id, storedToken.client_id, newExpiresAt
  );
  
  logAudit(user.id, 'TOKEN_REFRESH', req);
  
  res.json({
    access_token: accessToken,
    refresh_token: newRefreshToken,
    expires_in: 86400
  });
});

// User Self-Service: Update Profile
app.put('/api/user/profile', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const { full_name, phone } = req.body;
  
  db.prepare('UPDATE users SET full_name = ?, phone = ?, updated_at = ? WHERE id = ?').run(
    full_name || null, phone || null, new Date().toISOString(), userId
  );
  
  logAudit(userId, 'PROFILE_UPDATE', req, `Updated profile: full_name=${full_name}, phone=${phone}`);
  
  res.json({ message: 'Profile updated successfully' });
});

// User Self-Service: Change Password
app.put('/api/user/password', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const { current_password, new_password } = req.body;
  
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    logAudit(userId, 'PASSWORD_CHANGE_FAILED', req, 'Incorrect current password');
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  
  // Validate new password strength
  const strength = validatePasswordStrength(new_password);
  if (!strength.valid) {
    return res.status(400).json({ error: 'New password does not meet requirements', details: strength.errors });
  }
  
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?').run(
    hash, new Date().toISOString(), new Date().toISOString(), userId
  );
  
  // Invalidate all refresh tokens
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
  
  logAudit(userId, 'PASSWORD_CHANGE_SUCCESS', req, 'Password changed successfully');
  
  res.json({ message: 'Password changed successfully' });
});

// User Self-Service: Get Sessions
app.get('/api/user/sessions', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const sessions = db.prepare(`
    SELECT s.id, s.device_info, s.ip_address, s.last_active, s.created_at,
           (SELECT COUNT(*) FROM refresh_tokens rt WHERE rt.user_id = s.user_id AND rt.revoked = 0) as active_tokens
    FROM sessions s
    WHERE s.user_id = ? 
    ORDER BY s.last_active DESC
  `).all(userId);
  res.json(sessions);
});

// User Self-Service: Revoke Session (Remote Logout)
app.delete('/api/user/sessions/:id', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const currentSessionId = req.headers['x-session-id'];
  
  // Prevent revoking current session
  if (currentSessionId && id === currentSessionId) {
    return res.status(400).json({ error: 'Cannot revoke current session. Use logout instead.' });
  }
  
  // Check if session belongs to user
  const session: any = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, userId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  // Revoke all refresh tokens for this session/user (simplified: revoke all user tokens)
  // In production, you'd want to associate refresh tokens with specific sessions
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
  
  // Delete session
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  
  logAudit(userId, 'SESSION_REVOKED', req, `Session ${id} revoked remotely`);
  res.json({ message: 'Session revoked successfully' });
});

// User Self-Service: Get Linked Accounts
app.get('/api/user/linked-accounts', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const accounts = db.prepare(
    'SELECT provider, provider_username, created_at FROM linked_accounts WHERE user_id = ?'
  ).all(userId);
  res.json(accounts);
});

// Admin: Tenant Management
app.get('/api/admin/tenants', authenticateAdmin, (req, res) => {
  const tenants = db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all();
  res.json(tenants);
});

// Admin: Get All Sessions across all users
app.get('/api/admin/sessions', authenticateAdmin, (req, res) => {
  const sessions = db.prepare(`
    SELECT s.id, s.device_info, s.ip_address, s.last_active, s.created_at,
           u.username, u.email,
           (SELECT COUNT(*) FROM refresh_tokens rt WHERE rt.user_id = s.user_id AND rt.revoked = 0) as active_tokens
    FROM sessions s
    LEFT JOIN users u ON s.user_id = u.id
    ORDER BY s.last_active DESC
  `).all();
  res.json(sessions);
});

// Admin: Revoke any session
app.delete('/api/admin/sessions/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  
  const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  // Revoke all refresh tokens for this user
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(session.user_id);
  
  // Delete session
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  
  logAudit((req as any).user.id, 'ADMIN_SESSION_REVOKED', req, `Session ${id} revoked by admin`);
  res.json({ message: 'Session revoked successfully' });
});

app.post('/api/admin/tenants', authenticateAdmin, (req, res) => {
  const { name, domain, settings } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Tenant name is required' });
  }
  
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO tenants (id, name, domain, settings) VALUES (?, ?, ?, ?)').run(
    id, name, domain || null, JSON.stringify(settings || {})
  );
  
  logAudit((req as any).user.id, 'TENANT_CREATE', req, `Created tenant: ${name}`);
  
  res.json({ success: true, id });
});

app.put('/api/admin/tenants/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { name, domain, is_active, settings } = req.body;
  
  db.prepare('UPDATE tenants SET name = ?, domain = ?, is_active = ?, settings = ? WHERE id = ?').run(
    name, domain, is_active ? 1 : 0, JSON.stringify(settings || {}), id
  );
  
  logAudit((req as any).user.id, 'TENANT_UPDATE', req, `Updated tenant: ${id}`);
  
  res.json({ success: true });
});

app.delete('/api/admin/tenants/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  
  if (id === 'default') {
    return res.status(400).json({ error: 'Cannot delete default tenant' });
  }
  
  // Move users to default tenant
  db.prepare('UPDATE users SET tenant_id = ? WHERE tenant_id = ?').run('default', id);
  db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
  
  logAudit((req as any).user.id, 'TENANT_DELETE', req, `Deleted tenant: ${id}`);
  
  res.json({ success: true });
});

// Admin: Enhanced Audit Logs with filtering
app.get('/api/admin/audit/filter', authenticateAdmin, (req, res) => {
  const { action, user_id, tenant_id, start_date, end_date, limit = 100 } = req.query;
  
  let query = `
    SELECT a.*, u.username, t.name as tenant_name
    FROM audit_logs a 
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN tenants t ON a.tenant_id = t.id
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (action) {
    query += ' AND a.action = ?';
    params.push(action);
  }
  if (user_id) {
    query += ' AND a.user_id = ?';
    params.push(user_id);
  }
  if (tenant_id) {
    query += ' AND a.tenant_id = ?';
    params.push(tenant_id);
  }
  if (start_date) {
    query += ' AND a.created_at >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND a.created_at <= ?';
    params.push(end_date);
  }
  
  query += ' ORDER BY a.created_at DESC LIMIT ?';
  params.push(parseInt(limit as string));
  
  const logs = db.prepare(query).all(...params);
  res.json(logs);
});

// Get available actions for filtering
app.get('/api/admin/audit/actions', authenticateAdmin, (req, res) => {
  const actions = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all();
  res.json(actions.map((a: any) => a.action));
});

// Monitor: Statistics
app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  const tenantCount = db.prepare('SELECT COUNT(*) as count FROM tenants').get() as any;
  const clientCount = db.prepare('SELECT COUNT(*) as count FROM clients').get() as any;
  const activeTokens = db.prepare('SELECT COUNT(*) as count FROM access_tokens WHERE revoked = 0 AND expires_at > ?').get(new Date().toISOString()) as any;
  const activeSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as any;
  
  // Recent activity (last 24 hours)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentLogins = db.prepare('SELECT COUNT(*) as count FROM audit_logs WHERE action = ? AND created_at > ?').get('LOGIN_SUCCESS', yesterday) as any;
  const recentRegistrations = db.prepare('SELECT COUNT(*) as count FROM audit_logs WHERE action = ? AND created_at > ?').get('REGISTER', yesterday) as any;
  
  res.json({
    users: userCount.count,
    tenants: tenantCount.count,
    clients: clientCount.count,
    activeTokens: activeTokens.count,
    activeSessions: activeSessions.count,
    last24h: {
      logins: recentLogins.count,
      registrations: recentRegistrations.count
    }
  });
});

// GitHub OAuth Config
app.get('/api/auth/github/config', (req, res) => {
  const enabled = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  res.json({ enabled });
});

// GitHub OAuth - Initiate Authorization
app.get('/api/auth/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(503).json({
      error: 'GitHub OAuth is not configured',
      code: 'GITHUB_NOT_CONFIGURED'
    });
  }

  const callbackUrl = process.env.GITHUB_CALLBACK_URL || 'http://localhost:5986/api/auth/github/callback';

  // Clean up expired states before inserting a new one
  db.prepare('DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP').run();

  // Generate state and store in oauth_states with 10-minute expiry
  const state = generateOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)').run(state, expiresAt);

  // Construct GitHub authorization URL
  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('scope', 'read:user user:email');
  authUrl.searchParams.set('state', state);

  return res.redirect(302, authUrl.toString());
});

// GitHub OAuth - Callback Handler
app.get('/api/auth/github/callback', async (req, res) => {
  const { code, state, error: githubError } = req.query as Record<string, string>;

  // Handle GitHub error responses (e.g. user cancelled authorization)
  if (githubError) {
    const errorDesc = githubError === 'access_denied'
      ? 'GitHub authorization was cancelled'
      : githubError;
    logAudit(null, 'GITHUB_LOGIN_FAILED', req, `GitHub error: ${githubError}`);
    return res.redirect(302, `/login?error=${encodeURIComponent(errorDesc)}`);
  }

  // Validate state parameter
  const stateRecord = db.prepare(
    'SELECT state, expires_at FROM oauth_states WHERE state = ?'
  ).get(state) as { state: string; expires_at: string } | undefined;

  if (!stateRecord || new Date(stateRecord.expires_at) < new Date()) {
    // Delete expired record if it exists
    if (stateRecord) {
      db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    }
    return res.status(400).json({ error: 'Invalid or expired OAuth state' });
  }

  // Delete state immediately after validation (prevent replay attacks)
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

  // Exchange code for GitHub access token
  let githubAccessToken: string;
  try {
    githubAccessToken = await exchangeGitHubCode(code);
  } catch (err: any) {
    logAudit(null, 'GITHUB_LOGIN_FAILED', req, `Token exchange failed: ${err.message}`);
    return res.redirect(302, `/login?error=${encodeURIComponent('Failed to exchange GitHub authorization code')}`);
  }

  // Fetch GitHub user profile and emails
  let identity: GitHubIdentity;
  try {
    identity = await getGitHubUser(githubAccessToken);
    // Prefer primary+verified email from /user/emails over public profile email
    const verifiedEmail = await getGitHubEmails(githubAccessToken);
    if (verifiedEmail) {
      identity = { ...identity, email: verifiedEmail };
    }
  } catch (err: any) {
    logAudit(null, 'GITHUB_LOGIN_FAILED', req, `GitHub user info failed: ${err.message}`);
    return res.redirect(302, `/login?error=${encodeURIComponent('Failed to retrieve GitHub user information')}`);
  }

  // Find or create local user account
  let user: any;
  try {
    user = findOrCreateUserFromGitHub(identity, githubAccessToken);
  } catch (err: any) {
    logAudit(null, 'GITHUB_LOGIN_FAILED', req, `Account linking failed: ${err.message}`);
    return res.redirect(302, `/login?error=${encodeURIComponent('Failed to complete GitHub login')}`);
  }

  // Generate JWT access token (same format as password login)
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, tenant_id: user.tenant_id },
    JWT_SECRET,
    { expiresIn: '15m' }
  );

  // Store access token in database
  const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO access_tokens (id, token, client_id, user_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), accessToken, 'system', user.id, accessExpiresAt
  );

  // Generate refresh token (long-lived, 7 days)
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Create session record
  const sessionId = crypto.randomUUID();
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  db.prepare('INSERT INTO sessions (id, user_id, device_info, ip_address) VALUES (?, ?, ?, ?)').run(
    sessionId, user.id, userAgent, ip
  );

  // Store refresh token
  db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), refreshToken, user.id, null, refreshExpiresAt
  );

  // Write success audit log
  logAudit(user.id, 'GITHUB_LOGIN_SUCCESS', req, `GitHub username: ${identity.login}`);

  // Redirect to frontend with tokens in URL parameters
  return res.redirect(302, `/?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`);
});

// Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
