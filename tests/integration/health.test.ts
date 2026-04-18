import { describe, it, expect, afterAll, vi } from 'vitest';
vi.hoisted(() => {
  process.env.DB_PATH = 'health_integration.test.db';
});

import fs from 'fs';
import request from 'supertest';
import { app } from '../../server.js';
import { db } from '../../server/database.js';

const DB_FILE = process.env.DB_PATH!;

describe('Health API Integration', () => {
  afterAll(() => {
    if (fs.existsSync(DB_FILE)) {
      fs.unlinkSync(DB_FILE);
    }
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
