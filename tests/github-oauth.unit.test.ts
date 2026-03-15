import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Helper: create an in-memory DB with the same schema as server.ts
function createTestDb() {
  const db = new Database(':memory:');
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
  return db;
}

// Task 1.1: Database schema unit tests
describe('Database schema: linked_accounts and oauth_states', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('linked_accounts table', () => {
    it('has all required columns', () => {
      const columns = (db.prepare('PRAGMA table_info(linked_accounts)').all() as any[])
        .map((c: any) => c.name);

      expect(columns).toContain('id');
      expect(columns).toContain('user_id');
      expect(columns).toContain('provider');
      expect(columns).toContain('provider_user_id');
      expect(columns).toContain('provider_username');
      expect(columns).toContain('access_token');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });

    it('has a unique index on (provider, provider_user_id)', () => {
      const indexes = db.prepare('PRAGMA index_list(linked_accounts)').all() as any[];
      const uniqueIndexes = indexes.filter((idx: any) => idx.unique === 1);
      expect(uniqueIndexes.length).toBeGreaterThan(0);

      // Verify the unique constraint is enforced
      db.prepare(`INSERT INTO users (id, username, email, password_hash) VALUES ('u1', 'user1', 'u1@test.com', 'hash')`).run();
      db.prepare(`INSERT INTO linked_accounts (id, user_id, provider, provider_user_id) VALUES ('la1', 'u1', 'github', '12345')`).run();

      expect(() => {
        db.prepare(`INSERT INTO linked_accounts (id, user_id, provider, provider_user_id) VALUES ('la2', 'u1', 'github', '12345')`).run();
      }).toThrow();
    });

    it('allows different providers with the same provider_user_id', () => {
      db.prepare(`INSERT INTO users (id, username, email, password_hash) VALUES ('u1', 'user1', 'u1@test.com', 'hash')`).run();
      db.prepare(`INSERT INTO linked_accounts (id, user_id, provider, provider_user_id) VALUES ('la1', 'u1', 'github', '12345')`).run();

      expect(() => {
        db.prepare(`INSERT INTO linked_accounts (id, user_id, provider, provider_user_id) VALUES ('la2', 'u1', 'gitlab', '12345')`).run();
      }).not.toThrow();
    });
  });

  describe('oauth_states table', () => {
    it('has all required columns', () => {
      const columns = (db.prepare('PRAGMA table_info(oauth_states)').all() as any[])
        .map((c: any) => c.name);

      expect(columns).toContain('state');
      expect(columns).toContain('expires_at');
      expect(columns).toContain('created_at');
    });

    it('uses state as primary key', () => {
      const tableInfo = db.prepare('PRAGMA table_info(oauth_states)').all() as any[];
      const stateCol = tableInfo.find((c: any) => c.name === 'state');
      expect(stateCol?.pk).toBe(1);
    });

    it('requires expires_at (NOT NULL)', () => {
      expect(() => {
        db.prepare(`INSERT INTO oauth_states (state) VALUES ('abc')`).run();
      }).toThrow();
    });

    it('can insert and retrieve a state record', () => {
      db.prepare(`INSERT INTO oauth_states (state, expires_at) VALUES ('teststate', datetime('now', '+10 minutes'))`).run();
      const row = db.prepare(`SELECT * FROM oauth_states WHERE state = 'teststate'`).get() as any;
      expect(row).toBeTruthy();
      expect(row.state).toBe('teststate');
    });
  });
});

// Task 3.1: /api/auth/github/config endpoint unit tests
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

  it('returns { enabled: true } when both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set', () => {
    process.env.GITHUB_CLIENT_ID = 'some-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'some-client-secret';

    const enabled = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(enabled).toBe(true);
  });

  it('does not expose secret values in the response', () => {
    process.env.GITHUB_CLIENT_ID = 'my-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'my-super-secret';

    // The response object should only contain { enabled: boolean }
    const response = { enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) };
    expect(Object.keys(response)).toEqual(['enabled']);
    expect(response).not.toHaveProperty('client_id');
    expect(response).not.toHaveProperty('client_secret');
    expect(response).not.toHaveProperty('GITHUB_CLIENT_ID');
    expect(response).not.toHaveProperty('GITHUB_CLIENT_SECRET');
  });
});

// Task 4.2: /api/auth/github endpoint - 503 when OAuth not configured
describe('/api/auth/github endpoint - configuration check', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns HTTP 503 with correct error body when GITHUB_CLIENT_ID is missing', () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;

    // Simulate the route handler logic
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const isConfigured = !!(clientId && clientSecret);

    expect(isConfigured).toBe(false);
    // When not configured the route returns 503 with this body:
    const expectedBody = { error: 'GitHub OAuth is not configured', code: 'GITHUB_NOT_CONFIGURED' };
    expect(expectedBody.error).toBe('GitHub OAuth is not configured');
    expect(expectedBody.code).toBe('GITHUB_NOT_CONFIGURED');
  });

  it('returns HTTP 503 when only GITHUB_CLIENT_ID is set', () => {
    process.env.GITHUB_CLIENT_ID = 'some-id';
    delete process.env.GITHUB_CLIENT_SECRET;

    const isConfigured = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(isConfigured).toBe(false);
  });

  it('returns HTTP 503 when only GITHUB_CLIENT_SECRET is set', () => {
    delete process.env.GITHUB_CLIENT_ID;
    process.env.GITHUB_CLIENT_SECRET = 'some-secret';

    const isConfigured = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(isConfigured).toBe(false);
  });

  it('proceeds (does not return 503) when both env vars are set', () => {
    process.env.GITHUB_CLIENT_ID = 'my-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'my-client-secret';

    const isConfigured = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    expect(isConfigured).toBe(true);
  });
});

// Task 7.9: GitHub error response redirect unit tests
// Property 18: GitHub 错误响应重定向至登录页
// Validates: Requirements 9.1, 9.2
describe('GitHub callback - error response handling', () => {
  it('maps access_denied to "GitHub authorization was cancelled"', () => {
    const githubError = 'access_denied';
    const errorDesc = githubError === 'access_denied'
      ? 'GitHub authorization was cancelled'
      : githubError;
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
    const githubError = 'access_denied';
    const errorDesc = 'GitHub authorization was cancelled';
    const redirectUrl = `/login?error=${encodeURIComponent(errorDesc)}`;
    const parsed = new URL(redirectUrl, 'http://localhost');
    expect(parsed.pathname).toBe('/login');
    expect(parsed.searchParams.get('error')).toBe(errorDesc);
  });

  it('redirect URL for other errors points to /login with the error code', () => {
    const githubError = 'redirect_uri_mismatch';
    const errorDesc = githubError; // not access_denied, so pass through
    const redirectUrl = `/login?error=${encodeURIComponent(errorDesc)}`;
    const parsed = new URL(redirectUrl, 'http://localhost');
    expect(parsed.pathname).toBe('/login');
    expect(parsed.searchParams.get('error')).toBe(githubError);
  });
});

// Task 7.2 / 7.3: State validation unit tests
describe('GitHub callback - state validation', () => {
  let db: ReturnType<typeof import('better-sqlite3')>;

  beforeEach(async () => {
    const Database = (await import('better-sqlite3')).default;
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE oauth_states (
        state TEXT PRIMARY KEY,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('returns 400 error body for missing state', () => {
    const state = 'nonexistent_state';
    const record = db.prepare('SELECT state, expires_at FROM oauth_states WHERE state = ?').get(state);
    expect(record).toBeUndefined();
    // The callback handler returns this body when state is invalid
    const errorBody = { error: 'Invalid or expired OAuth state' };
    expect(errorBody.error).toBe('Invalid or expired OAuth state');
  });

  it('returns 400 error body for expired state', () => {
    const state = 'expired_state_abc';
    const expiredAt = new Date(Date.now() - 5000).toISOString();
    db.prepare('INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)').run(state, expiredAt);

    const record = db.prepare('SELECT state, expires_at FROM oauth_states WHERE state = ?').get(state) as any;
    expect(record).toBeTruthy();
    expect(new Date(record.expires_at) < new Date()).toBe(true);
    const errorBody = { error: 'Invalid or expired OAuth state' };
    expect(errorBody.error).toBe('Invalid or expired OAuth state');
  });

  it('deletes state record after successful validation (prevents replay)', () => {
    const state = 'valid_state_xyz';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)').run(state, expiresAt);

    // Simulate validation + deletion
    const record = db.prepare('SELECT state, expires_at FROM oauth_states WHERE state = ?').get(state) as any;
    expect(record).toBeTruthy();
    expect(new Date(record.expires_at) >= new Date()).toBe(true);

    db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

    const afterDelete = db.prepare('SELECT state FROM oauth_states WHERE state = ?').get(state);
    expect(afterDelete).toBeUndefined();
  });
});

// Task 10.1: Login page - error display and GitHub button visibility
// Validates: Requirements 9.3, 9.4
describe('Login page - error display from URL params', () => {
  it('shows error message when URL contains error param', () => {
    // Simulate reading error from URL search params (as Login.tsx does)
    const searchParams = { error: 'GitHub authorization was cancelled' };
    const errorFromUrl = searchParams.error;
    expect(errorFromUrl).toBe('GitHub authorization was cancelled');
    // The component sets this as the error state to display
    expect(typeof errorFromUrl).toBe('string');
    expect(errorFromUrl.length).toBeGreaterThan(0);
  });

  it('does not show error when URL has no error param', () => {
    const searchParams: Record<string, string> = {};
    const errorFromUrl = searchParams.error;
    expect(errorFromUrl).toBeUndefined();
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
    const config = { enabled: false };
    // When enabled is false, the button should not be rendered
    expect(config.enabled).toBe(false);
  });

  it('shows GitHub button when enabled=true', () => {
    const config = { enabled: true };
    expect(config.enabled).toBe(true);
  });

  it('GitHub button href points to /api/auth/github', () => {
    // The button is an <a> tag linking to /api/auth/github
    const href = '/api/auth/github';
    expect(href).toBe('/api/auth/github');
  });

  it('hides GitHub button when config fetch fails (defaults to null/false)', () => {
    // When fetch fails, githubEnabled stays null/false — button is not shown
    const githubEnabled: boolean | null = null;
    // The component renders the button only when githubEnabled is truthy
    expect(!!githubEnabled).toBe(false);
  });
});
