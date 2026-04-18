import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { 
  revokeToken, 
  isTokenRevoked, 
  revokeAllUserTokens, 
  revokeOtherUserTokens, 
  cleanupRevokedTokens,
  RevokeReason 
} from '../server/utils/token-blacklist.js';

const { mockDb } = await vi.hoisted(async () => {
  const { default: Database } = await import('better-sqlite3');
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
  return { mockDb: db };
});

vi.mock('../server/database.js', () => ({
  db: mockDb
}));

describe('Token Blacklist Module (Unit)', () => {
  beforeEach(() => {
    mockDb.prepare('DELETE FROM access_tokens').run();
  });

  describe('revokeToken', () => {
    beforeEach(() => {
      mockDb.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('token-1', 'test-access-token', 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());
    });

    it('revokes an existing token using the real function', () => {
      const success = revokeToken('test-access-token', RevokeReason.LOGOUT);
      expect(success).toBe(true);

      const token = mockDb.prepare('SELECT * FROM access_tokens WHERE token = ?').get('test-access-token') as any;
      expect(token.revoked).toBe(1);
      expect(token.revoke_reason).toBe('LOGOUT');
      expect(token.revoked_at).toBeTruthy();
    });

    it('does not revoke an already revoked token', () => {
      revokeToken('test-access-token');
      const secondAttempt = revokeToken('test-access-token');
      expect(secondAttempt).toBe(false);
    });

    it('returns false for non-existent token', () => {
      const result = revokeToken('non-existent-token');
      expect(result).toBe(false);
    });
  });

  describe('isTokenRevoked', () => {
    it('returns true for revoked token', () => {
      mockDb.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run('token-1', 'revoked-token', 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());

      expect(isTokenRevoked('revoked-token')).toBe(true);
    });

    it('returns false for non-revoked token', () => {
      mockDb.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('token-1', 'active-token', 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());

      expect(isTokenRevoked('active-token')).toBe(false);
    });

    it('returns true for non-existent token (default safety)', () => {
      expect(isTokenRevoked('non-existent')).toBe(true);
    });
  });

  describe('revokeAllUserTokens', () => {
    beforeEach(() => {
      for (let i = 1; i <= 3; i++) {
        mockDb.prepare(`
          INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run(`token-id-${i}`, `token-${i}`, 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());
      }
      mockDb.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('token-id-4', 'token-4', 'client-1', 'user-2', new Date(Date.now() + 3600000).toISOString());
    });

    it('revokes all tokens for a specific user', () => {
      const revokedCount = revokeAllUserTokens('user-1');
      expect(revokedCount).toBe(3);

      const user1Tokens = mockDb.prepare('SELECT * FROM access_tokens WHERE user_id = ?').all('user-1') as any[];
      expect(user1Tokens.every(t => t.revoked === 1)).toBe(true);

      const user2Token = mockDb.prepare('SELECT * FROM access_tokens WHERE user_id = ?').all('user-2') as any[];
      expect(user2Token[0].revoked).toBe(0);
    });
  });

  describe('revokeOtherUserTokens', () => {
    beforeEach(() => {
      for (let i = 1; i <= 3; i++) {
        mockDb.prepare(`
          INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run(`token-id-${i}`, `token-${i}`, 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());
      }
    });

    it('revokes all tokens except the current one', () => {
      const count = revokeOtherUserTokens('user-1', 'token-2');
      expect(count).toBe(2);

      const currentToken = mockDb.prepare('SELECT * FROM access_tokens WHERE token = ?').get('token-2') as any;
      expect(currentToken.revoked).toBe(0);

      const otherTokens = mockDb.prepare('SELECT * FROM access_tokens WHERE user_id = ? AND token != ?').all('user-1', 'token-2') as any[];
      expect(otherTokens.every(t => t.revoked === 1)).toBe(true);
    });
  });

  describe('cleanupRevokedTokens', () => {
    beforeEach(() => {
      mockDb.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run('expired-1', 'expired-token-1', 'client-1', 'user-1', new Date(Date.now() - 3600000).toISOString());

      mockDb.prepare(`
        INSERT INTO access_tokens (id, token, client_id, user_id, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run('active-1', 'active-token-1', 'client-1', 'user-1', new Date(Date.now() + 3600000).toISOString());
    });

    it('deletes only expired revoked tokens using real cleanup logic', () => {
      const changes = cleanupRevokedTokens();
      expect(changes).toBe(1);

      const remaining = mockDb.prepare('SELECT * FROM access_tokens').all() as any[];
      expect(remaining.length).toBe(1);
      expect(remaining[0].token).toBe('active-token-1');
    });
  });
});
