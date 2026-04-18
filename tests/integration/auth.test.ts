import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
vi.hoisted(() => {
  process.env.DB_PATH = 'auth_integration.test.db';
});

const DB_FILE = process.env.DB_PATH!;

import fs from 'fs';
import request from 'supertest';
import { app } from '../../server.js';
import { db } from '../../server/database.js';

// Mock email service to prevent actual emails
vi.mock('../../server/services/email.service.js', () => ({
  emailService: {
    sendVerificationEmail: vi.fn().mockResolvedValue(true),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
    sendAccountDeletionConfirmEmail: vi.fn().mockResolvedValue(true),
  }
}));

describe('Auth API Integration', () => {
  const testUser = {
    username: 'testuser',
    email: 'test@example.com',
    password: 'Password123!',
  };

  afterAll(() => {
    // Cleanup the test database file
    if (fs.existsSync(DB_FILE)) {
      fs.unlinkSync(DB_FILE);
    }
  });

  beforeEach(() => {
    // Clean tables before each test to ensure isolation
    const tables = [
      'email_verifications',
      'refresh_tokens',
      'sessions',
      'password_resets',
      'access_tokens',
      'trusted_devices',
      'linked_accounts',
      'account_deletion_requests'
    ];
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare('DELETE FROM users WHERE username != ?').run('admin');
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a new user', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(testUser);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'User registered successfully');

      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(testUser.username) as any;
      expect(user).toBeTruthy();
      expect(user.email).toBe(testUser.email);
      expect(user.email_verified).toBe(0);
    });

    it('returns error if email already exists', async () => {
      // Register once
      await request(app).post('/api/auth/register').send(testUser);
      
      // Register again
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
          password: 'passwordvlow', // Passes Zod (min 8) but fails route handler (complexity)
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Password does not meet requirements');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create a verified user for login tests
      await request(app).post('/api/auth/register').send(testUser);
      db.prepare('UPDATE users SET email_verified = 1 WHERE username = ?').run(testUser.username);
    });

    it('successfully logs in with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('access_token');
      expect(response.body.data).toHaveProperty('refresh_token');
      expect(response.body.data.user.username).toBe(testUser.username);
    });

    it('returns error for invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUser.username,
          password: 'WrongPassword!',
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });

    it('refuses login for unverified users', async () => {
      db.prepare('UPDATE users SET email_verified = 0 WHERE username = ?').run(testUser.username);
      
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Email not verified');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('successfully refreshes token', async () => {
      // Setup: register, verify and login to get refresh token
      await request(app).post('/api/auth/register').send(testUser);
      db.prepare('UPDATE users SET email_verified = 1 WHERE username = ?').run(testUser.username);
      
      const loginRes = await request(app).post('/api/auth/login').send({
        username: testUser.username,
        password: testUser.password,
      });
      
      const oldRefreshToken = loginRes.body.data.refresh_token;

      // Act
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refresh_token: oldRefreshToken });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('access_token');
      expect(response.body.data).toHaveProperty('refresh_token');
      expect(response.body.data.refresh_token).not.toBe(oldRefreshToken);
    });
  });
});
