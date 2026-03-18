import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Create a test database with the access_tokens table
function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_tokens (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked INTEGER DEFAULT 0,
      revoked_at DATETIME,
      revoke_reason TEXT,
      scope TEXT DEFAULT 'openid'
    );
  `);
  return db;
}

describe('Token Blacklist Module', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('revokeToken', () => {
    beforeEach(() => {
      // Insert a test token
      db.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('token-1', 'test-access-token', 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());
    });

    it('revokes an existing token', () => {
      const result = db.prepare(`
        UPDATE access_tokens 
        SET revoked = 1, revoked_at = ?, revoke_reason = ?
        WHERE token = ? AND revoked = 0
      `).run(new Date().toISOString(), 'LOGOUT', 'test-access-token');

      expect(result.changes).toBe(1);

      const token = db.prepare('SELECT * FROM access_tokens WHERE token = ?').get('test-access-token') as any;
      expect(token.revoked).toBe(1);
      expect(token.revoke_reason).toBe('LOGOUT');
      expect(token.revoked_at).toBeTruthy();
    });

    it('does not revoke an already revoked token', () => {
      // First revoke
      db.prepare(`
        UPDATE access_tokens 
        SET revoked = 1, revoked_at = ?, revoke_reason = ?
        WHERE token = ? AND revoked = 0
      `).run(new Date().toISOString(), 'LOGOUT', 'test-access-token');

      // Try to revoke again
      const result = db.prepare(`
        UPDATE access_tokens 
        SET revoked = 1, revoked_at = ?, revoke_reason = ?
        WHERE token = ? AND revoked = 0
      `).run(new Date().toISOString(), 'PASSWORD_CHANGE', 'test-access-token');

      expect(result.changes).toBe(0);
    });

    it('returns false for non-existent token', () => {
      const result = db.prepare(`
        UPDATE access_tokens 
        SET revoked = 1, revoked_at = ?, revoke_reason = ?
        WHERE token = ? AND revoked = 0
      `).run(new Date().toISOString(), 'LOGOUT', 'non-existent-token');

      expect(result.changes).toBe(0);
    });
  });

  describe('isTokenRevoked', () => {
    it('returns true for revoked token', () => {
      db.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run('token-1', 'revoked-token', 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());

      const record = db.prepare('SELECT revoked FROM access_tokens WHERE token = ?').get('revoked-token') as any;
      expect(!record || record.revoked === 1).toBe(true);
    });

    it('returns false for non-revoked token', () => {
      db.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('token-1', 'active-token', 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());

      const record = db.prepare('SELECT revoked FROM access_tokens WHERE token = ?').get('active-token') as any;
      expect(!record || record.revoked === 1).toBe(false);
    });

    it('returns true for non-existent token', () => {
      const record = db.prepare('SELECT revoked FROM access_tokens WHERE token = ?').get('non-existent');
      expect(!record).toBe(true);
    });
  });

  describe('revokeAllUserTokens', () => {
    beforeEach(() => {
      // Insert multiple tokens for a user
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run(`token-id-${i}`, `token-${i}`, 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());
      }
      // Insert a token for another user
      db.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('token-id-4', 'token-4', 'client-1', 'user-2', new Date(Date.now() + 3600000).toISOString());
    });

    it('revokes all tokens for a specific user', () => {
      const result = db.prepare(`
        UPDATE access_tokens 
        SET revoked = 1, revoked_at = ?, revoke_reason = ?
        WHERE user_id = ? AND revoked = 0
      `).run(new Date().toISOString(), 'SESSION_INVALIDATION', 'user-1');

      expect(result.changes).toBe(3);

      const user1Tokens = db.prepare('SELECT * FROM access_tokens WHERE user_id = ?').all('user-1') as any[];
      expect(user1Tokens.every(t => t.revoked === 1)).toBe(true);

      const user2Token = db.prepare('SELECT * FROM access_tokens WHERE user_id = ?').all('user-2') as any[];
      expect(user2Token[0].revoked).toBe(0);
    });
  });

  describe('revokeOtherUserTokens', () => {
    beforeEach(() => {
      // Insert multiple tokens for a user
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run(`token-id-${i}`, `token-${i}`, 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());
      }
    });

    it('revokes all tokens except the current one', () => {
      const result = db.prepare(`
        UPDATE access_tokens 
        SET revoked = 1, revoked_at = ?, revoke_reason = ?
        WHERE user_id = ? AND token != ? AND revoked = 0
      `).run(new Date().toISOString(), 'PASSWORD_CHANGE', 'user-1', 'token-2');

      expect(result.changes).toBe(2);

      const currentToken = db.prepare('SELECT * FROM access_tokens WHERE token = ?').get('token-2') as any;
      expect(currentToken.revoked).toBe(0);

      const otherTokens = db.prepare('SELECT * FROM access_tokens WHERE user_id = ? AND token != ?').all('user-1', 'token-2') as any[];
      expect(otherTokens.every(t => t.revoked === 1)).toBe(true);
    });
  });

  describe('cleanupRevokedTokens', () => {
    beforeEach(() => {
      // Insert expired revoked tokens
      db.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run('expired-1', 'expired-token-1', 'client-1', 'user-1', new Date(Date.now() - 3600000).toISOString());

      // Insert active revoked tokens
      db.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run('active-1', 'active-token-1', 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());
    });

    it('deletes only expired revoked tokens', () => {
      const result = db.prepare(`
        DELETE FROM access_tokens 
        WHERE revoked = 1 AND expires_at < ?
      `).run(new Date().toISOString());

      expect(result.changes).toBe(1);

      const remaining = db.prepare('SELECT * FROM access_tokens').all() as any[];
      expect(remaining.length).toBe(1);
      expect(remaining[0].token).toBe('active-token-1');
    });
  });
});
