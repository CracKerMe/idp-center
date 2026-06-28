import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });
import { db, initDatabase } from '../../server/database.js';
import { sql, eq } from 'drizzle-orm';
import {
  users,
  emailVerifications,
  refreshTokens,
  sessions,
  passwordResets,
  accessTokens,
  trustedDevices,
  linkedAccounts,
  accountDeletionRequests,
  passwordHistory,
} from '../../server/schema.js';

import { app } from '../../server.js';
import request from 'supertest';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

describe.skipIf(skipIfNoDb)('User API Integration', () => {
  const testUser = {
    username: 'userprofiletest',
    email: 'userprofile@example.com',
    password: 'Password123!',
  };
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(async () => {
    await db.delete(passwordHistory);
    await db.delete(accountDeletionRequests);
    await db.delete(linkedAccounts);
    await db.delete(trustedDevices);
    await db.delete(accessTokens);
    await db.delete(passwordResets);
    await db.delete(sessions);
    await db.delete(refreshTokens);
    await db.delete(emailVerifications);
    await db.delete(users).where(eq(users.username, 'userprofiletest'));

    const regRes = await request(app).post('/api/auth/register').send(testUser);
    expect(regRes.status).toBe(200);

    await db.update(users).set({ emailVerified: true }).where(eq(users.username, testUser.username));

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

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      expect(user.fullName).toBe(updateData.full_name);
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
