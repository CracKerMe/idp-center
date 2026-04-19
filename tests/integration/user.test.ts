import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
vi.hoisted(() => {
  process.env.DB_PATH = 'user_integration.test.db';
});

import fs from 'fs';
import request from 'supertest';
import { app } from '../../server.js';
import { db } from '../../server/database.js';

const DB_FILE = process.env.DB_PATH!;

describe('User API Integration', () => {
  const testUser = {
    username: 'userprofiletest',
    email: 'userprofile@example.com',
    password: 'Password123!',
  };
  let accessToken: string;
  let userId: string;

  afterAll(() => {
    if (fs.existsSync(DB_FILE)) {
      fs.unlinkSync(DB_FILE);
    }
  });

  beforeEach(async () => {
    // Cleanup
    const tables = [
      'email_verifications',
      'refresh_tokens',
      'sessions',
      'password_resets',
      'access_tokens',
      'trusted_devices',
      'linked_accounts',
      'account_deletion_requests',
      'password_history',
    ];
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare('DELETE FROM users WHERE username != ?').run('admin');
    
    // Register, verify and login to get access token
    const regRes = await request(app).post('/api/auth/register').send(testUser);
    expect(regRes.status).toBe(200);

    db.prepare('UPDATE users SET email_verified = 1 WHERE username = ?').run(testUser.username);
    
    const loginRes = await request(app).post('/api/auth/login').send({
      username: testUser.username,
      password: testUser.password,
    });
    
    expect(loginRes.status).toBe(200);
    accessToken = loginRes.body.data.access_token;
    userId = loginRes.body.data.user.id;
  });

  describe('GET /api/auth/me', () => {
    it('returns own profile for authenticated user', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.username).toBe(testUser.username);
      expect(response.body.data.id).toBe(userId);
    });

    it('returns 401 for unauthenticated request', async () => {
      const response = await request(app).get('/api/auth/me');
      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/user/profile', () => {
    it('successfully updates user profile', async () => {
      const updateData = {
        full_name: 'Test Name',
        phone: '1234567890',
      };

      const response = await request(app)
        .put('/api/user/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Profile updated successfully');

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
      expect(user.full_name).toBe(updateData.full_name);
      expect(user.phone).toBe(updateData.phone);
    });
  });

  describe('GET /api/user/sessions', () => {
    it('returns list of sessions', async () => {
      const response = await request(app)
        .get('/api/user/sessions')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });
});
