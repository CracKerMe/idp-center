import { describe, it, expect, beforeAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { initDatabase } from '../../server/database.js';

import { app } from '../../server.js';
import request from 'supertest';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

describe.skipIf(skipIfNoDb)('Health API Integration', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('returns 200 and healthy status', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body.services).toHaveProperty('database', 'ok');
  });

  it('returns 404 for unknown routes', async () => {
    const response = await request(app).get('/api/not-found-route');
    expect(response.status).toBe(404);
  });
});
