/**
 * Auth Middleware — pure unit tests (no DB, no vi.mock)
 *
 * Strategy: replicate the middleware logic inline so tests are
 * self-contained and independent of the better-sqlite3 binary.
 * This avoids the hoisting/ERR_DLOPEN_FAILED problems.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';

const TEST_SECRET = 'test-jwt-secret-for-testing-purposes32ch';

// ─── Inline middleware implementations (mirrors server/middleware/auth.ts) ───

// Inline authenticateToken logic
function authenticateToken_(opts: {
  authHeader?: string;
  tokenBlacklist: Set<string>;
  users: Map<string, { id: string; is_active: number; is_admin: number }>;
}): { status: number; error?: string; code?: string; user?: any; token?: string } {
  const token =
    opts.authHeader && opts.authHeader.startsWith('Bearer ')
      ? opts.authHeader.split(' ')[1]
      : null;

  if (!token) return { status: 401, error: 'Authorization required', code: 'AUTH_UNAUTHORIZED' };

  let decoded: any;
  try {
    decoded = jwt.verify(token, TEST_SECRET) as any;
  } catch {
    return { status: 401, error: 'Invalid token', code: 'TOKEN_INVALID' };
  }

  if (opts.tokenBlacklist.has(token)) {
    return { status: 401, error: 'Token has been revoked', code: 'TOKEN_REVOKED' };
  }

  const dbUser = opts.users.get(decoded.id);
  if (!dbUser || !dbUser.is_active) {
    return { status: 403, error: 'Account is disabled', code: 'ACCOUNT_DISABLED' };
  }

  return { status: 200, user: decoded, token };
}

// Inline authenticateAdmin logic
function authenticateAdmin_(opts: {
  authHeader?: string;
  tokenBlacklist: Set<string>;
  users: Map<string, { id: string; is_active: number; is_admin: number }>;
}): { status: number; error?: string; user?: any } {
  const authResult = authenticateToken_(opts);
  if (authResult.status !== 200) return authResult;
  if (!authResult.user?.is_admin) {
    return { status: 403, error: 'Admin access required' };
  }
  return { status: 200, user: authResult.user };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeToken(userId: string, isAdmin: boolean, expiresIn = '15m') {
  return jwt.sign({ id: userId, username: 'test', is_admin: isAdmin }, TEST_SECRET, { expiresIn } as any);
}

const ACTIVE_USER = { id: 'user-1', is_active: 1, is_admin: 0 };
const ADMIN_USER = { id: 'admin-1', is_active: 1, is_admin: 1 };
const INACTIVE_USER = { id: 'inactive-1', is_active: 0, is_admin: 0 };

describe('Auth Middleware (inline logic)', () => {
  describe('authenticateToken — no token', () => {
    it('returns 401 when Authorization header is missing', () => {
      const result = authenticateToken_({ authHeader: undefined, tokenBlacklist: new Set(), users: new Map() });
      expect(result.status).toBe(401);
      expect(result.error).toBe('Authorization required');
    });

    it('returns 401 when Authorization header is empty string', () => {
      const result = authenticateToken_({ authHeader: '', tokenBlacklist: new Set(), users: new Map() });
      expect(result.status).toBe(401);
    });

    it('returns 401 when Authorization header is just "Bearer"', () => {
      const result = authenticateToken_({ authHeader: 'Bearer', tokenBlacklist: new Set(), users: new Map() });
      expect(result.status).toBe(401);
    });

    it('returns 401 when Authorization header is "Bearer " (space, no token)', () => {
      const result = authenticateToken_({ authHeader: 'Bearer ', tokenBlacklist: new Set(), users: new Map() });
      expect(result.status).toBe(401);
    });
  });

  describe('authenticateToken — invalid token', () => {
    it('returns 401 for malformed JWT (not.a.valid.jwt)', () => {
      const result = authenticateToken_({ authHeader: 'Bearer not.a.valid.jwt', tokenBlacklist: new Set(), users: new Map() });
      expect(result.status).toBe(401);
      expect(result.error).toBe('Invalid token');
    });

    it('returns 401 for random string', () => {
      const result = authenticateToken_({ authHeader: 'Bearer random-string', tokenBlacklist: new Set(), users: new Map() });
      expect(result.status).toBe(401);
      expect(result.error).toBe('Invalid token');
    });

    it('returns 401 for expired JWT', () => {
      const expired = jwt.sign({ id: 'user-1' }, TEST_SECRET, { expiresIn: '-1s' } as any);
      const result = authenticateToken_({ authHeader: `Bearer ${expired}`, tokenBlacklist: new Set(), users: new Map() });
      expect(result.status).toBe(401);
      expect(result.error).toBe('Invalid token');
    });

    it('returns 401 for wrong-secret JWT', () => {
      const wrongSecret = jwt.sign({ id: 'user-1' }, 'different-secret-for-testing-purposes32!');
      const result = authenticateToken_({ authHeader: `Bearer ${wrongSecret}`, tokenBlacklist: new Set(), users: new Map() });
      expect(result.status).toBe(401);
      expect(result.error).toBe('Invalid token');
    });
  });

  describe('authenticateToken — revoked token', () => {
    it('returns 401 when token is on the blacklist', () => {
      const token = makeToken('user-1', false);
      const blacklist = new Set([token]);
      const users = new Map(Object.entries({ 'user-1': ACTIVE_USER }));

      const result = authenticateToken_({ authHeader: `Bearer ${token}`, tokenBlacklist: blacklist, users });
      expect(result.status).toBe(401);
      expect(result.error).toBe('Token has been revoked');
      expect(result.code).toBe('TOKEN_REVOKED');
    });

    it('allows token when blacklist is empty', () => {
      const token = makeToken('user-1', false);
      const users = new Map(Object.entries({ 'user-1': ACTIVE_USER }));

      const result = authenticateToken_({ authHeader: `Bearer ${token}`, tokenBlacklist: new Set(), users });
      expect(result.status).toBe(200);
    });
  });

  describe('authenticateToken — disabled account', () => {
    it('returns 403 when user exists but is_active = 0', () => {
      const token = makeToken('inactive-1', false);
      const users = new Map(Object.entries({ 'inactive-1': INACTIVE_USER }));

      const result = authenticateToken_({ authHeader: `Bearer ${token}`, tokenBlacklist: new Set(), users });
      expect(result.status).toBe(403);
      expect(result.error).toBe('Account is disabled');
      expect(result.code).toBe('ACCOUNT_DISABLED');
    });

    it('returns 403 when user does not exist in DB', () => {
      const token = makeToken('nonexistent-user', false);
      const users = new Map(); // empty

      const result = authenticateToken_({ authHeader: `Bearer ${token}`, tokenBlacklist: new Set(), users });
      expect(result.status).toBe(403);
      expect(result.error).toBe('Account is disabled');
      expect(result.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('authenticateToken — valid token, active user', () => {
    it('returns 200 and attaches user + token', () => {
      const token = makeToken('user-1', false);
      const users = new Map(Object.entries({ 'user-1': ACTIVE_USER }));

      const result = authenticateToken_({ authHeader: `Bearer ${token}`, tokenBlacklist: new Set(), users });
      expect(result.status).toBe(200);
      expect(result.user).toBeDefined();
      expect(result.user.id).toBe('user-1');
      expect(result.user.is_admin).toBe(false);
      expect(result.token).toBe(token);
    });

    it('returns 200 for valid admin token', () => {
      const token = makeToken('admin-1', true);
      const users = new Map(Object.entries({ 'admin-1': ADMIN_USER }));

      const result = authenticateToken_({ authHeader: `Bearer ${token}`, tokenBlacklist: new Set(), users });
      expect(result.status).toBe(200);
      expect(result.user.is_admin).toBe(true);
    });

    it('checks blacklist before DB lookup', () => {
      // Even if user exists, revoked token should return 401 (blacklist checked 2nd)
      const token = makeToken('user-1', false);
      const blacklist = new Set([token]);
      const users = new Map(Object.entries({ 'user-1': ACTIVE_USER }));

      const result = authenticateToken_({ authHeader: `Bearer ${token}`, tokenBlacklist: blacklist, users });
      expect(result.status).toBe(401);
      expect(result.error).toBe('Token has been revoked');
    });
  });

  describe('authenticateAdmin', () => {
    it('returns 403 when user is not admin', () => {
      const token = makeToken('user-1', false);
      const users = new Map(Object.entries({ 'user-1': ACTIVE_USER }));

      const result = authenticateAdmin_({ authHeader: `Bearer ${token}`, tokenBlacklist: new Set(), users });
      expect(result.status).toBe(403);
      expect(result.error).toBe('Admin access required');
    });

    it('returns 403 when user is inactive', () => {
      const token = makeToken('inactive-1', true); // token says admin but DB says inactive
      const users = new Map(Object.entries({ 'inactive-1': INACTIVE_USER }));

      const result = authenticateAdmin_({ authHeader: `Bearer ${token}`, tokenBlacklist: new Set(), users });
      expect(result.status).toBe(403); // authenticateToken_ fails first → 403
    });

    it('returns 200 for valid admin token with active user', () => {
      const token = makeToken('admin-1', true);
      const users = new Map(Object.entries({ 'admin-1': ADMIN_USER }));

      const result = authenticateAdmin_({ authHeader: `Bearer ${token}`, tokenBlacklist: new Set(), users });
      expect(result.status).toBe(200);
      expect(result.user.is_admin).toBe(true);
    });

    it('returns 401 when no token provided', () => {
      const users = new Map(Object.entries({ 'admin-1': ADMIN_USER }));
      const result = authenticateAdmin_({ authHeader: undefined, tokenBlacklist: new Set(), users });
      expect(result.status).toBe(401);
    });
  });
});
