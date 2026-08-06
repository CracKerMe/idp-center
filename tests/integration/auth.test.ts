import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { db, initDatabase } from '../../server/database.js';
import { sql, eq, inArray } from 'drizzle-orm';
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

vi.mock('../../server/services/email.service.js', () => ({
  emailService: {
    sendVerificationEmail: vi.fn().mockResolvedValue(true),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
    sendAccountDeletionConfirmEmail: vi.fn().mockResolvedValue(true),
  },
}));

import { app } from '../../server.js';
import request from 'supertest';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

describe.skipIf(skipIfNoDb)('Auth API Integration', () => {
  const testUser = {
    username: 'testuser',
    email: 'test@example.com',
    password: 'Password123!',
  };

  beforeAll(async () => {
    await initDatabase(); // push schema + seed defaults
  });

  beforeEach(async () => {
    // Clean test data in reverse dependency order
    await db.delete(passwordHistory).where(
      inArray(passwordHistory.userId, db.select({ id: users.id }).from(users).where(eq(users.username, 'testuser')))
    );
    await db.delete(accountDeletionRequests).where(
      inArray(accountDeletionRequests.userId, db.select({ id: users.id }).from(users).where(eq(users.username, 'testuser')))
    );
    await db.delete(linkedAccounts).where(
      inArray(linkedAccounts.userId, db.select({ id: users.id }).from(users).where(eq(users.username, 'testuser')))
    );
    await db.delete(trustedDevices).where(
      inArray(trustedDevices.userId, db.select({ id: users.id }).from(users).where(eq(users.username, 'testuser')))
    );
    // Scoped to this file's own user: access_tokens is a shared table and other
    // integration test files run concurrently against the same database.
    await db.delete(accessTokens).where(
      inArray(accessTokens.userId, db.select({ id: users.id }).from(users).where(eq(users.username, 'testuser')))
    );
    await db.delete(passwordResets).where(
      inArray(passwordResets.userId, db.select({ id: users.id }).from(users).where(eq(users.username, 'testuser')))
    );
    await db.delete(sessions).where(
      inArray(sessions.userId, db.select({ id: users.id }).from(users).where(eq(users.username, 'testuser')))
    );
    await db.delete(refreshTokens).where(
      inArray(refreshTokens.userId, db.select({ id: users.id }).from(users).where(eq(users.username, 'testuser')))
    );
    await db.delete(emailVerifications).where(
      inArray(emailVerifications.userId, db.select({ id: users.id }).from(users).where(eq(users.username, 'testuser')))
    );
    await db.delete(users).where(eq(users.username, 'testuser'));
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a new user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(testUser);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'User registered successfully');

      const [user] = await db.select().from(users).where(eq(users.username, testUser.username)).limit(1);
      expect(user).toBeTruthy();
      expect(user.email).toBe(testUser.email);
      expect(user.emailVerified).toBe(false);
    });

    it('returns error if email already exists', async () => {
      await request(app).post('/api/auth/register').send(testUser);

      const response = await request(app)
        .post('/api/auth/register')
        .send(testUser);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Username or email already exists');
    });

    it('validates password strength', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'badpass',
          email: 'bad@example.com',
          password: 'passwordvlow',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Password does not meet requirements');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(testUser);
      await db.update(users).set({ emailVerified: true }).where(eq(users.username, testUser.username));
    });

    it('successfully logs in with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: testUser.username, password: testUser.password });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('access_token');
      expect(response.body.data).toHaveProperty('refresh_token');
      expect(response.body.data.user.username).toBe(testUser.username);
    });

    it('returns error for invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: testUser.username, password: 'WrongPassword!' });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });

    it('refuses login for unverified users', async () => {
      await db.update(users).set({ emailVerified: false }).where(eq(users.username, testUser.username));

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: testUser.username, password: testUser.password });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Email not verified');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('successfully refreshes token', async () => {
      await request(app).post('/api/auth/register').send(testUser);
      await db.update(users).set({ emailVerified: true }).where(eq(users.username, testUser.username));

      const loginRes = await request(app).post('/api/auth/login').send({
        username: testUser.username,
        password: testUser.password,
      });

      const oldRefreshToken = loginRes.body.data.refresh_token;

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refresh_token: oldRefreshToken });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('access_token');
      expect(response.body.data).toHaveProperty('refresh_token');
      expect(response.body.data.refresh_token).not.toBe(oldRefreshToken);

      // Regression check: the new access_token must actually be usable. isTokenRevoked()
      // is fail-closed (no access_tokens row = revoked), so if /refresh ever stops
      // recording the token it issues, this 401s even though the response above looked fine.
      const meResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${response.body.data.access_token}`);
      expect(meResponse.status).toBe(200);
    });
  });
});
