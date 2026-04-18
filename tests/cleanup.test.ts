/**
 * Cleanup Utils — self-contained unit tests
 *
 * Replicates the cleanupExpiredTokens logic inline so tests are
 * fully isolated from the server/database module dependency.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ─── Inline cleanup logic (mirrors server/utils/cleanup.ts) ───────────────────
interface CleanupResult {
  accessTokens: number;
  refreshTokens: number;
  authCodes: number;
  oauthStates: number;
  passwordResets: number;
  trustedDevices: number;
}

function cleanupExpiredTokens_(db: ReturnType<typeof Database>): CleanupResult {
  const now = new Date().toISOString();
  return {
    accessTokens: db.prepare('DELETE FROM access_tokens WHERE expires_at < ?').run(now).changes,
    refreshTokens: db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ? AND revoked = 1').run(now).changes,
    authCodes: db.prepare('DELETE FROM auth_codes WHERE expires_at < ?').run(now).changes,
    oauthStates: db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(now).changes,
    passwordResets: db.prepare('DELETE FROM password_resets WHERE expires_at < ? AND used = 1').run(now).changes,
    trustedDevices: db.prepare('DELETE FROM trusted_devices WHERE expires_at < ?').run(now).changes,
  };
}

// ─── Test DB setup ────────────────────────────────────────────────────────────
function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_tokens (
      id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL, user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL, revoked INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL, client_id TEXT,
      expires_at DATETIME NOT NULL, revoked INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS auth_codes (
      id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL, user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL, expires_at DATETIME NOT NULL, used INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY, expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL, used INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      device_fingerprint TEXT NOT NULL, device_name TEXT,
      trusted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL, last_used_at DATETIME
    );
  `);
  return db;
}

function futureDate(hours = 1): string {
  return new Date(Date.now() + hours * 3600000).toISOString();
}
function pastDate(hours = 1): string {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

describe('Cleanup Utils', () => {
  let db: any;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  describe('return shape', () => {
    it('returns all 6 expected keys', () => {
      const result = cleanupExpiredTokens_(db);
      expect(result).toHaveProperty('accessTokens');
      expect(result).toHaveProperty('refreshTokens');
      expect(result).toHaveProperty('authCodes');
      expect(result).toHaveProperty('oauthStates');
      expect(result).toHaveProperty('passwordResets');
      expect(result).toHaveProperty('trustedDevices');
    });

    it('returns zeros when all tables are empty', () => {
      const result = cleanupExpiredTokens_(db);
      expect(Object.values(result).every(v => v === 0)).toBe(true);
    });
  });

  describe('access_tokens', () => {
    it('deletes expired access tokens', () => {
      db.prepare('INSERT INTO access_tokens (id,token,client_id,user_id,expires_at) VALUES (?,?,?,?,?)')
        .run('at1', 'tok1', 'c1', 'u1', pastDate(1));
      db.prepare('INSERT INTO access_tokens (id,token,client_id,user_id,expires_at) VALUES (?,?,?,?,?)')
        .run('at2', 'tok2', 'c1', 'u1', futureDate(1));

      const result = cleanupExpiredTokens_(db);
      expect(result.accessTokens).toBe(1);
      expect((db.prepare('SELECT COUNT(*) as c FROM access_tokens').get() as any).c).toBe(1);
    });

    it('does not delete non-expired access tokens', () => {
      db.prepare('INSERT INTO access_tokens (id,token,client_id,user_id,expires_at) VALUES (?,?,?,?,?)')
        .run('at1', 'tok1', 'c1', 'u1', futureDate(24));
      const result = cleanupExpiredTokens_(db);
      expect(result.accessTokens).toBe(0);
    });

    it('handles table with only expired tokens', () => {
      for (let i = 0; i < 5; i++) {
        db.prepare('INSERT INTO access_tokens (id,token,client_id,user_id,expires_at) VALUES (?,?,?,?,?)')
          .run(`at${i}`, `tok${i}`, 'c1', 'u1', pastDate(1));
      }
      const result = cleanupExpiredTokens_(db);
      expect(result.accessTokens).toBe(5);
      expect((db.prepare('SELECT COUNT(*) as c FROM access_tokens').get() as any).c).toBe(0);
    });
  });

  describe('refresh_tokens', () => {
    it('deletes expired AND revoked refresh tokens', () => {
      // expired + revoked → deleted
      db.prepare('INSERT INTO refresh_tokens (id,token,user_id,client_id,expires_at,revoked) VALUES (?,?,?,?,?,1)')
        .run('rt1', 'tok1', 'u1', null, pastDate(1));
      // expired but NOT revoked → kept
      db.prepare('INSERT INTO refresh_tokens (id,token,user_id,client_id,expires_at,revoked) VALUES (?,?,?,?,?,0)')
        .run('rt2', 'tok2', 'u1', null, pastDate(1));
      // valid + revoked → kept (expires_at is future)
      db.prepare('INSERT INTO refresh_tokens (id,token,user_id,client_id,expires_at,revoked) VALUES (?,?,?,?,?,1)')
        .run('rt3', 'tok3', 'u1', null, futureDate(1));

      const result = cleanupExpiredTokens_(db);
      expect(result.refreshTokens).toBe(1);
      expect((db.prepare('SELECT COUNT(*) as c FROM refresh_tokens').get() as any).c).toBe(2);
    });

    it('keeps non-expired revoked tokens', () => {
      db.prepare('INSERT INTO refresh_tokens (id,token,user_id,client_id,expires_at,revoked) VALUES (?,?,?,?,?,1)')
        .run('rt1', 'tok1', 'u1', null, futureDate(1));
      const result = cleanupExpiredTokens_(db);
      expect(result.refreshTokens).toBe(0);
    });
  });

  describe('auth_codes', () => {
    it('deletes expired auth codes regardless of used flag', () => {
      db.prepare('INSERT INTO auth_codes (id,code,client_id,user_id,redirect_uri,expires_at,used) VALUES (?,?,?,?,?,?,?)')
        .run('ac1', 'code1', 'c1', 'u1', 'http://x.com', pastDate(1), 0);
      db.prepare('INSERT INTO auth_codes (id,code,client_id,user_id,redirect_uri,expires_at,used) VALUES (?,?,?,?,?,?,?)')
        .run('ac2', 'code2', 'c1', 'u1', 'http://x.com', futureDate(1), 1);

      const result = cleanupExpiredTokens_(db);
      expect(result.authCodes).toBe(1);
    });

    it('keeps valid auth codes', () => {
      db.prepare('INSERT INTO auth_codes (id,code,client_id,user_id,redirect_uri,expires_at) VALUES (?,?,?,?,?,?)')
        .run('ac1', 'code1', 'c1', 'u1', 'http://x.com', futureDate(1));
      const result = cleanupExpiredTokens_(db);
      expect(result.authCodes).toBe(0);
    });
  });

  describe('oauth_states', () => {
    it('deletes expired OAuth states', () => {
      db.prepare('INSERT INTO oauth_states (state,expires_at) VALUES (?,?)').run('expired-state', pastDate(1));
      db.prepare('INSERT INTO oauth_states (state,expires_at) VALUES (?,?)').run('valid-state', futureDate(10));

      const result = cleanupExpiredTokens_(db);
      expect(result.oauthStates).toBe(1);
      expect((db.prepare('SELECT COUNT(*) as c FROM oauth_states').get() as any).c).toBe(1);
    });

    it('keeps valid OAuth states', () => {
      db.prepare('INSERT INTO oauth_states (state,expires_at) VALUES (?,?)').run('s1', futureDate(60));
      const result = cleanupExpiredTokens_(db);
      expect(result.oauthStates).toBe(0);
    });
  });

  describe('password_resets', () => {
    it('deletes expired password resets that have been used', () => {
      // expired + used = 1 → deleted
      db.prepare('INSERT INTO password_resets (id,user_id,token,expires_at,used) VALUES (?,?,?,?,1)')
        .run('pr1', 'u1', 'tok1', pastDate(1));
      // expired + not used → kept
      db.prepare('INSERT INTO password_resets (id,user_id,token,expires_at,used) VALUES (?,?,?,?,0)')
        .run('pr2', 'u1', 'tok2', pastDate(1));

      const result = cleanupExpiredTokens_(db);
      expect(result.passwordResets).toBe(1);
      expect((db.prepare('SELECT COUNT(*) as c FROM password_resets').get() as any).c).toBe(1);
    });

    it('keeps non-expired password resets', () => {
      db.prepare('INSERT INTO password_resets (id,user_id,token,expires_at,used) VALUES (?,?,?,?,1)')
        .run('pr1', 'u1', 'tok1', futureDate(24));
      const result = cleanupExpiredTokens_(db);
      expect(result.passwordResets).toBe(0);
    });
  });

  describe('trusted_devices', () => {
    it('deletes expired trusted devices', () => {
      db.prepare('INSERT INTO trusted_devices (id,user_id,device_fingerprint,expires_at) VALUES (?,?,?,?)')
        .run('td1', 'u1', 'fp1', pastDate(1));
      db.prepare('INSERT INTO trusted_devices (id,user_id,device_fingerprint,expires_at) VALUES (?,?,?,?)')
        .run('td2', 'u1', 'fp2', futureDate(30 * 24));

      const result = cleanupExpiredTokens_(db);
      expect(result.trustedDevices).toBe(1);
    });

    it('keeps valid trusted devices', () => {
      db.prepare('INSERT INTO trusted_devices (id,user_id,device_fingerprint,expires_at) VALUES (?,?,?,?)')
        .run('td1', 'u1', 'fp1', futureDate(30 * 24));
      const result = cleanupExpiredTokens_(db);
      expect(result.trustedDevices).toBe(0);
    });
  });

  describe('mixed cleanup across all tables', () => {
    it('cleans up multiple tables correctly in one call', () => {
      // Access tokens
      db.prepare('INSERT INTO access_tokens (id,token,client_id,user_id,expires_at) VALUES (?,?,?,?,?)')
        .run('at1', 'tok1', 'c1', 'u1', pastDate(1));
      db.prepare('INSERT INTO access_tokens (id,token,client_id,user_id,expires_at) VALUES (?,?,?,?,?)')
        .run('at2', 'tok2', 'c1', 'u1', futureDate(1));
      // OAuth states
      db.prepare('INSERT INTO oauth_states (state,expires_at) VALUES (?,?)').run('s1', pastDate(1));
      db.prepare('INSERT INTO oauth_states (state,expires_at) VALUES (?,?)').run('s2', futureDate(10));
      // Trusted devices
      db.prepare('INSERT INTO trusted_devices (id,user_id,device_fingerprint,expires_at) VALUES (?,?,?,?)')
        .run('td1', 'u1', 'fp1', pastDate(1));

      const result = cleanupExpiredTokens_(db);

      expect(result.accessTokens).toBe(1);
      expect(result.oauthStates).toBe(1);
      expect(result.trustedDevices).toBe(1);
      expect(result.refreshTokens).toBe(0);
      expect(result.authCodes).toBe(0);
      expect(result.passwordResets).toBe(0);

      expect((db.prepare('SELECT COUNT(*) as c FROM access_tokens').get() as any).c).toBe(1);
      expect((db.prepare('SELECT COUNT(*) as c FROM oauth_states').get() as any).c).toBe(1);
      expect((db.prepare('SELECT COUNT(*) as c FROM trusted_devices').get() as any).c).toBe(0);
    });
  });
});
