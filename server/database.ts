import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export const db = new Database('auth.db');

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

// Database migrations — add missing columns to existing tables
const migrations = [
  { table: 'users', column: 'tenant_id', sql: 'ALTER TABLE users ADD COLUMN tenant_id TEXT DEFAULT "default"' },
  { table: 'users', column: 'full_name', sql: 'ALTER TABLE users ADD COLUMN full_name TEXT' },
  { table: 'users', column: 'avatar_url', sql: 'ALTER TABLE users ADD COLUMN avatar_url TEXT' },
  { table: 'users', column: 'phone', sql: 'ALTER TABLE users ADD COLUMN phone TEXT' },
  { table: 'users', column: 'password_changed_at', sql: 'ALTER TABLE users ADD COLUMN password_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP' },
  { table: 'users', column: 'failed_login_attempts', sql: 'ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0' },
  { table: 'users', column: 'locked_until', sql: 'ALTER TABLE users ADD COLUMN locked_until DATETIME' },
  { table: 'users', column: 'email_verified', sql: 'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0' },
  { table: 'users', column: 'email_verified_at', sql: 'ALTER TABLE users ADD COLUMN email_verified_at DATETIME' },
  { table: 'refresh_tokens', column: 'remember_me', sql: 'ALTER TABLE refresh_tokens ADD COLUMN remember_me INTEGER DEFAULT 0' },
  { table: 'refresh_tokens', column: 'device_id', sql: 'ALTER TABLE refresh_tokens ADD COLUMN device_id TEXT' },
  { table: 'auth_codes', column: 'nonce', sql: 'ALTER TABLE auth_codes ADD COLUMN nonce TEXT' },
  { table: 'auth_codes', column: 'scope', sql: "ALTER TABLE auth_codes ADD COLUMN scope TEXT DEFAULT 'openid'" },
  { table: 'auth_codes', column: 'code_challenge', sql: 'ALTER TABLE auth_codes ADD COLUMN code_challenge TEXT' },
  { table: 'auth_codes', column: 'code_challenge_method', sql: "ALTER TABLE auth_codes ADD COLUMN code_challenge_method TEXT DEFAULT 'S256'" },
  { table: 'access_tokens', column: 'scope', sql: "ALTER TABLE access_tokens ADD COLUMN scope TEXT DEFAULT 'openid'" },
  { table: 'access_tokens', column: 'revoked_at', sql: 'ALTER TABLE access_tokens ADD COLUMN revoked_at DATETIME' },
  { table: 'access_tokens', column: 'revoke_reason', sql: 'ALTER TABLE access_tokens ADD COLUMN revoke_reason TEXT' },
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

// Create indexes
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_email_tenant ON users(email, tenant_id)');
} catch (err) {
  // Index might already exist
}

// Additional tables
db.exec(`
  CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    new_email TEXT,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS trusted_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_fingerprint TEXT NOT NULL,
    device_name TEXT,
    trusted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_used_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id, device_fingerprint)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    scheduled_delete_at DATETIME NOT NULL,
    cancelled_at DATETIME,
    completed_at DATETIME,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Seed default tenant
const tenantExists = db.prepare('SELECT id FROM tenants WHERE id = ?').get('default');
if (!tenantExists) {
  db.prepare('INSERT INTO tenants (id, name, domain, is_active) VALUES (?, ?, ?, ?)').run(
    'default', 'Default Tenant', 'localhost', 1
  );
}

// Seed admin user
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (id, tenant_id, username, email, password_hash, is_admin, email_verified, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run(
    crypto.randomUUID(), 'default', 'admin', 'admin@example.com', hash, 1, new Date().toISOString()
  );
}

// Seed default client
const clientExists = db.prepare('SELECT id FROM clients WHERE client_id = ?').get('default-client');
if (!clientExists) {
  db.prepare('INSERT INTO clients (id, client_id, client_secret, client_name, redirect_uris, grant_types) VALUES (?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), 'default-client', 'secret123', 'Default Client', 'http://localhost:5986/callback,http://localhost:3000/callback', 'authorization_code'
  );
}
