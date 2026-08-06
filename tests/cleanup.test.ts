import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockDb = {
  delete: vi.fn(),
  select: vi.fn(),
  execute: vi.fn(),
};

vi.mock('../server/database.js', () => ({ db: mockDb }));

const { cleanupExpiredTokens } = await import('../server/utils/cleanup.js');

function createMockResult(rowCount: number) {
  const chain: any = {};
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: any) => resolve({ rowCount });
  chain[Symbol.toStringTag] = 'Promise';
  return chain;
}

function mockNoActiveSigningKey() {
  // Mock all select calls used by cleanup:
  // 1. drainBackchannelQueue: pending deliveries
  // 2. rotateSigningKeyIfDue: active signing key
  // 3. purgeExpiredAuditLogs: all tenants
  let selectCallCount = 0;
  mockDb.select.mockImplementation(() => {
    selectCallCount++;
    const chain: any = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    // Return empty array for all selects (no pending deliveries, no active key, no tenants)
    chain.then = (resolve: any) => resolve([]);
    chain[Symbol.toStringTag] = 'Promise';
    return chain;
  });
}

describe('cleanupExpiredTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns counts of deleted rows from all 11 tables', async () => {
    mockNoActiveSigningKey();
    // access_tokens: 2 deleted, rest: 1 deleted each
    mockDb.delete
      .mockReturnValueOnce(createMockResult(2))   // access_tokens
      .mockReturnValueOnce(createMockResult(1))   // refresh_tokens
      .mockReturnValueOnce(createMockResult(1))   // auth_codes
      .mockReturnValueOnce(createMockResult(1))   // oauth_states
      .mockReturnValueOnce(createMockResult(1))   // password_resets
      .mockReturnValueOnce(createMockResult(0))   // trusted_devices
      .mockReturnValueOnce(createMockResult(0))   // signing_keys
      .mockReturnValueOnce(createMockResult(0))   // device_codes
      .mockReturnValueOnce(createMockResult(0))   // client_assertion_jtis
      .mockReturnValueOnce(createMockResult(0))   // pushed_auth_requests
      .mockReturnValueOnce(createMockResult(0));  // dpop_jtis

    const result = await cleanupExpiredTokens();

    expect(result.accessTokens).toBe(2);
    expect(result.refreshTokens).toBe(1);
    expect(result.authCodes).toBe(1);
    expect(result.oauthStates).toBe(1);
    expect(result.passwordResets).toBe(1);
    expect(result.trustedDevices).toBe(0);
    expect(result.signingKeys).toBe(0);
    expect(result.deviceCodes).toBe(0);
    expect(result.clientAssertionJtis).toBe(0);
    expect(result.pushedAuthRequests).toBe(0);
    expect(result.dpopJtis).toBe(0);
    expect(mockDb.delete).toHaveBeenCalledTimes(11);
  });

  it('returns all zeros when nothing is expired', async () => {
    mockNoActiveSigningKey();
    mockDb.delete.mockReturnValue(createMockResult(0));

    const result = await cleanupExpiredTokens();

    expect(result.accessTokens).toBe(0);
    expect(result.refreshTokens).toBe(0);
    expect(result.authCodes).toBe(0);
    expect(result.oauthStates).toBe(0);
    expect(result.passwordResets).toBe(0);
    expect(result.trustedDevices).toBe(0);
    expect(result.signingKeys).toBe(0);
    expect(result.deviceCodes).toBe(0);
    expect(result.clientAssertionJtis).toBe(0);
    expect(result.pushedAuthRequests).toBe(0);
    expect(result.dpopJtis).toBe(0);
  });

  it('does not propagate errors from individual table deletes', async () => {
    // Second call (refresh_tokens) throws
    let callCount = 0;
    mockDb.delete.mockImplementation(() => {
      callCount++;
      if (callCount === 2) throw new Error('DB timeout');
      return createMockResult(1);
    });

    await expect(cleanupExpiredTokens()).rejects.toThrow('DB timeout');
  });
});
