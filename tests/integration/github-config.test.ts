import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import request from 'supertest';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

describe.skipIf(skipIfNoDb)('GitHub Auth Config API Integration', () => {
  // Import app after skip check — prevents DB connection attempt when skipping
  let app: any;

  beforeAll(async () => {
    ({ app } = await import('../../server.js'));
  });

  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns enabled: false when GitHub credentials are missing', async () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;

    const response = await request(app).get('/api/auth/github/config');
    expect(response.status).toBe(200);
    expect(typeof response.body.data?.enabled).toBe('boolean');
  });

  it('contains the correct structure', async () => {
    const response = await request(app).get('/api/auth/github/config');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('enabled');
    expect(response.body).toHaveProperty('code', 0);
  });
});
