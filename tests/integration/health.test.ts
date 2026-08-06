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

  it('returns 200 and healthy status on /health (legacy)', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body.services).toHaveProperty('database', 'ok');
  });

  it('returns 200 on /livez', async () => {
    const response = await request(app).get('/livez');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body).toHaveProperty('version');
    expect(response.body).toHaveProperty('uptime');
  });

  it('returns 200 on /readyz when database is healthy', async () => {
    const response = await request(app).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body.services).toHaveProperty('database');
    expect(response.body.services.database).toHaveProperty('status', 'ok');
  });

  it('returns 404 for unknown routes', async () => {
    const response = await request(app).get('/api/not-found-route');
    expect(response.status).toBe(404);
  });
});
