import { describe, it, expect, beforeEach, vi } from 'vitest';

// Helper to create chainable mock query builder
// Drizzle select queries resolve to arrays, update/delete resolve to { rowCount }
function createMockChain(returnRows: any[] = [], rowCount = 0) {
  const chain: any = {};
  chain.where = vi.fn().mockReturnValue(chain);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: any) => resolve(returnRows); // select resolves to array
  chain[Symbol.toStringTag] = 'Promise';
  return chain;
}

// For update/delete — resolves with { rowCount }
function createMockMutationResult(rowCount = 0) {
  const chain: any = {};
  chain.where = vi.fn().mockReturnValue(chain);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: any) => resolve({ rowCount });
  chain[Symbol.toStringTag] = 'Promise';
  return chain;
}

// Mock the schema module to return table references
vi.mock('../server/schema.js', () => ({
  accessTokens: {
    id: 'id', token: 'token', userId: 'user_id',
    revoked: 'revoked', revokedAt: 'revoked_at',
    revokeReason: 'revoke_reason', expiresAt: 'expires_at',
  },
}));

const mockDb = {
  select: vi.fn().mockReturnValue(createMockChain()),
  insert: vi.fn().mockReturnValue(createMockChain()),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../server/database.js', () => ({ db: mockDb }));

const {
  revokeToken,
  isTokenRevoked,
  revokeAllUserTokens,
  revokeOtherUserTokens,
  cleanupRevokedTokens,
  RevokeReason,
} = await import('../server/utils/token-blacklist.js');

describe('Token Blacklist Module (Unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(createMockChain());
    mockDb.update.mockReturnValue(createMockMutationResult(0));
    mockDb.delete.mockReturnValue(createMockMutationResult(0));
  });

  describe('revokeToken', () => {
    it('revokes an existing token', async () => {
      mockDb.update.mockReturnValue(createMockMutationResult(1));
      const result = await revokeToken('test-token', RevokeReason.LOGOUT);
      expect(result).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('returns false when no rows affected', async () => {
      mockDb.update.mockReturnValue(createMockMutationResult(0));
      const result = await revokeToken('test-token');
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      mockDb.update.mockImplementation(() => { throw new Error('DB error'); });
      const result = await revokeToken('test-token');
      expect(result).toBe(false);
    });
  });

  describe('isTokenRevoked', () => {
    it('returns true for revoked token', async () => {
      mockDb.select.mockReturnValue(createMockChain([{ revoked: true }]));
      const result = await isTokenRevoked('revoked-token');
      expect(result).toBe(true);
    });

    it('returns false for non-revoked token', async () => {
      mockDb.select.mockReturnValue(createMockChain([{ revoked: false }]));
      const result = await isTokenRevoked('active-token');
      expect(result).toBe(false);
    });

    it('returns true for non-existent token', async () => {
      mockDb.select.mockReturnValue(createMockChain([]));
      const result = await isTokenRevoked('non-existent');
      expect(result).toBe(true);
    });
  });

  describe('revokeAllUserTokens', () => {
    it('revokes all tokens for a specific user', async () => {
      mockDb.update.mockReturnValue(createMockMutationResult(3));
      const result = await revokeAllUserTokens('user-1');
      expect(result).toBe(3);
    });

    it('returns 0 on error', async () => {
      mockDb.update.mockImplementation(() => { throw new Error('DB error'); });
      const result = await revokeAllUserTokens('user-1');
      expect(result).toBe(0);
    });
  });

  describe('revokeOtherUserTokens', () => {
    it('revokes all tokens except the current one', async () => {
      mockDb.update.mockReturnValue(createMockMutationResult(2));
      const result = await revokeOtherUserTokens('user-1', 'current-token');
      expect(result).toBe(2);
    });
  });

  describe('cleanupRevokedTokens', () => {
    it('deletes expired revoked tokens', async () => {
      mockDb.delete.mockReturnValue(createMockMutationResult(1));
      const result = await cleanupRevokedTokens();
      expect(result).toBe(1);
    });

    it('returns 0 on error', async () => {
      mockDb.delete.mockImplementation(() => { throw new Error('DB error'); });
      const result = await cleanupRevokedTokens();
      expect(result).toBe(0);
    });
  });
});
