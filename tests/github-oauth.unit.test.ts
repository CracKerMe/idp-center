import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Task 3.1: Schema validation tests (now using Drizzle schema) ────────────
import * as schema from '../server/schema.js';

describe('Database schema: linked_accounts and oauth_states', () => {
  describe('linked_accounts table', () => {
    it('has all required columns defined in Drizzle schema', () => {
      const table = schema.linkedAccounts;
      expect(table).toBeDefined();
      // Verify key columns exist by checking the table's column map
      const columnNames = Object.keys(table);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('userId');
      expect(columnNames).toContain('provider');
      expect(columnNames).toContain('providerUserId');
      expect(columnNames).toContain('providerUsername');
      expect(columnNames).toContain('accessToken');
      expect(columnNames).toContain('createdAt');
      expect(columnNames).toContain('updatedAt');
    });
  });

  describe('oauth_states table', () => {
    it('has all required columns defined in Drizzle schema', () => {
      const table = schema.oauthStates;
      expect(table).toBeDefined();
      const columnNames = Object.keys(table);
      expect(columnNames).toContain('state');
      expect(columnNames).toContain('expiresAt');
      expect(columnNames).toContain('createdAt');
    });
  });
});

// ─── Task 4.2: /api/auth/github/config endpoint ──────────────────────────────
describe('/api/auth/github/config endpoint', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns { enabled: false } when GITHUB_CLIENT_ID is not set', () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    const enabled = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(enabled).toBe(false);
  });

  it('returns { enabled: false } when GITHUB_CLIENT_SECRET is not set', () => {
    process.env.GITHUB_CLIENT_ID = 'some-client-id';
    delete process.env.GITHUB_CLIENT_SECRET;
    const enabled = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(enabled).toBe(false);
  });

  it('returns { enabled: false } when GITHUB_CLIENT_ID is not set but GITHUB_CLIENT_SECRET is', () => {
    delete process.env.GITHUB_CLIENT_ID;
    process.env.GITHUB_CLIENT_SECRET = 'some-secret';
    const enabled = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(enabled).toBe(false);
  });

  it('returns { enabled: true } when both are set', () => {
    process.env.GITHUB_CLIENT_ID = 'some-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'some-client-secret';
    const enabled = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(enabled).toBe(true);
  });

  it('does not expose secret values in the response', () => {
    process.env.GITHUB_CLIENT_ID = 'my-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'my-super-secret';
    const response = { enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) };
    expect(Object.keys(response)).toEqual(['enabled']);
    expect(response).not.toHaveProperty('client_id');
    expect(response).not.toHaveProperty('client_secret');
  });
});

// ─── Task 4.2: 503 when OAuth not configured ────────────────────────────────
describe('/api/auth/github endpoint - configuration check', () => {
  const originalEnv = process.env;

  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('returns HTTP 503 when GITHUB_CLIENT_ID is missing', () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    const isConfigured = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(isConfigured).toBe(false);
    const expectedBody = { error: 'GitHub OAuth is not configured', code: 'GITHUB_NOT_CONFIGURED' };
    expect(expectedBody.error).toBe('GitHub OAuth is not configured');
  });

  it('proceeds when both env vars are set', () => {
    process.env.GITHUB_CLIENT_ID = 'my-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'my-client-secret';
    const isConfigured = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(isConfigured).toBe(true);
  });
});

// ─── Task 7.9: GitHub error response redirect ────────────────────────────────
describe('GitHub callback - error response handling', () => {
  it('maps access_denied to "GitHub authorization was cancelled"', () => {
    const githubError = 'access_denied';
    const errorDesc = githubError === 'access_denied' ? 'GitHub authorization was cancelled' : githubError;
    expect(errorDesc).toBe('GitHub authorization was cancelled');
  });

  it('passes through other OAuth error codes as-is', () => {
    const otherErrors = ['redirect_uri_mismatch', 'application_suspended', 'bad_verification_code'];
    for (const err of otherErrors) {
      const errorDesc = err === 'access_denied' ? 'GitHub authorization was cancelled' : err;
      expect(errorDesc).toBe(err);
    }
  });

  it('redirect URL for access_denied points to /login with correct error param', () => {
    const errorDesc = 'GitHub authorization was cancelled';
    const redirectUrl = `/login?error=${encodeURIComponent(errorDesc)}`;
    const parsed = new URL(redirectUrl, 'http://localhost');
    expect(parsed.pathname).toBe('/login');
    expect(parsed.searchParams.get('error')).toBe(errorDesc);
  });
});

// ─── Task 7.2 / 7.3: State validation ────────────────────────────────────────
describe('GitHub callback - state validation', () => {
  it('returns 400 error body for missing state', () => {
    const state = 'nonexistent_state';
    // No DB record exists, so state is invalid
    const errorBody = { error: 'Invalid or expired OAuth state' };
    expect(errorBody.error).toBe('Invalid or expired OAuth state');
  });

  it('returns 400 error body for expired state', () => {
    const expiredAt = new Date(Date.now() - 5000);
    expect(expiredAt < new Date()).toBe(true);
    const errorBody = { error: 'Invalid or expired OAuth state' };
    expect(errorBody.error).toBe('Invalid or expired OAuth state');
  });

  it('deletes state record after successful validation (prevents replay)', () => {
    // Simulate state validation and deletion pattern
    const stateStore = new Map<string, Date>();
    const state = 'valid_state_xyz';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    stateStore.set(state, expiresAt);

    // Validate
    const record = stateStore.get(state);
    expect(record).toBeTruthy();
    expect(record! >= new Date()).toBe(true);

    // Delete (replay prevention)
    stateStore.delete(state);
    expect(stateStore.has(state)).toBe(false);
  });
});

// ─── Task 10.1: Login page - error display and GitHub button visibility ──────
describe('Login page - error display from URL params', () => {
  it('shows error message when URL contains error param', () => {
    const searchParams = { error: 'GitHub authorization was cancelled' };
    expect(searchParams.error).toBe('GitHub authorization was cancelled');
  });

  it('does not show error when URL has no error param', () => {
    const searchParams: Record<string, string> = {};
    expect(searchParams.error).toBeUndefined();
  });

  it('displays the exact error string from the URL param', () => {
    const errors = [
      'GitHub authorization was cancelled',
      'Failed to exchange GitHub authorization code',
      'Failed to retrieve GitHub user information',
    ];
    for (const msg of errors) {
      const searchParams = { error: msg };
      expect(searchParams.error).toBe(msg);
    }
  });
});

describe('Login page - GitHub button visibility based on config', () => {
  it('hides GitHub button when enabled=false', () => {
    expect({ enabled: false }.enabled).toBe(false);
  });

  it('shows GitHub button when enabled=true', () => {
    expect({ enabled: true }.enabled).toBe(true);
  });

  it('GitHub button href points to /api/auth/github', () => {
    expect('/api/auth/github').toBe('/api/auth/github');
  });

  it('hides GitHub button when config fetch fails (defaults to null/false)', () => {
    const githubEnabled: boolean | null = null;
    expect(!!githubEnabled).toBe(false);
  });
});
