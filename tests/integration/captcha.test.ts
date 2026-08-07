import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { db, initDatabase } from '../../server/database.js';
import { like, eq, inArray } from 'drizzle-orm';
import {
  users,
  emailVerifications,
  refreshTokens,
  sessions,
  accessTokens,
  trustedDevices,
  passwordHistory,
  accountDeletionRequests,
  linkedAccounts,
  passwordResets,
} from '../../server/schema.js';
import { config, CAPTCHA_CONFIG } from '../../server/config.js';

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

const PASSWORD = 'Password123!';

async function registerVerifiedUser(username: string) {
  await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@example.com`, password: PASSWORD });
  await db.update(users).set({ emailVerified: true }).where(eq(users.username, username));
}

/**
 * Solves a real challenge deterministically using the NODE_ENV=test-only piece_x
 * escape hatch (server/services/captcha.service.ts's issueChallenge), with a
 * trail that satisfies every hard gate and stays under the soft-signal
 * suspicion threshold — same shape as the humanTrail() helper in
 * tests/captcha-verify.test.ts / tests/captcha-service.test.ts.
 */
function humanTrail(targetX: number, samples = 10) {
  const trail: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const frac = i / (samples - 1);
    const eased = 1 - (1 - frac) ** 2;
    trail.push({ x: Math.round(eased * targetX), y: i % 2 === 0 ? 1 : -1, t: i * 30 });
  }
  trail[trail.length - 1].x = targetX;
  return trail;
}

async function fetchChallenge(username: string) {
  const res = await request(app).post('/api/auth/captcha/challenge').send({ username });
  expect(res.status).toBe(200);
  expect(typeof res.body.data.piece_x).toBe('number'); // test-only escape hatch, NODE_ENV=test
  return res.body.data as { challenge_id: string; piece_x: number };
}

async function solveChallenge(username: string): Promise<string> {
  const challenge = await fetchChallenge(username);
  const res = await request(app).post('/api/auth/captcha/verify').send({
    challenge_id: challenge.challenge_id,
    x: challenge.piece_x,
    trail: humanTrail(challenge.piece_x),
    input_mode: 'pointer',
  });
  expect(res.status).toBe(200);
  expect(res.body.data.captcha_pass).toMatch(/^[0-9a-f]{64}$/);
  return res.body.data.captcha_pass as string;
}

describe.skipIf(skipIfNoDb)('Captcha-gated login (integration)', () => {
  const originalMode = config.CAPTCHA_MODE;

  beforeAll(async () => {
    await initDatabase();
  });

  afterEach(async () => {
    (config as any).CAPTCHA_MODE = originalMode;
    const testUsers = db.select({ id: users.id }).from(users).where(like(users.username, 'captcha\\_%'));
    await db.delete(passwordHistory).where(inArray(passwordHistory.userId, testUsers));
    await db.delete(accountDeletionRequests).where(inArray(accountDeletionRequests.userId, testUsers));
    await db.delete(linkedAccounts).where(inArray(linkedAccounts.userId, testUsers));
    await db.delete(trustedDevices).where(inArray(trustedDevices.userId, testUsers));
    await db.delete(accessTokens).where(inArray(accessTokens.userId, testUsers));
    await db.delete(passwordResets).where(inArray(passwordResets.userId, testUsers));
    await db.delete(sessions).where(inArray(sessions.userId, testUsers));
    await db.delete(refreshTokens).where(inArray(refreshTokens.userId, testUsers));
    await db.delete(emailVerifications).where(inArray(emailVerifications.userId, testUsers));
    await db.delete(users).where(like(users.username, 'captcha\\_%'));
  });

  afterAll(() => {
    (config as any).CAPTCHA_MODE = originalMode;
  });

  describe('CAPTCHA_MODE=enforce', () => {
    beforeEach(() => {
      (config as any).CAPTCHA_MODE = 'enforce';
    });

    it('requires a captcha only after crossing the failure threshold, and gates before the DB user lookup', async () => {
      const username = 'captcha_enforce_a';
      await registerVerifiedUser(username);

      // Below threshold: ordinary 401s, no captcha involved yet.
      for (let i = 0; i < CAPTCHA_CONFIG.triggerThreshold - 1; i++) {
        const res = await request(app).post('/api/auth/login').send({ username, password: 'wrong' });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
      }

      // Threshold-crossing failure still reports as a plain credentials error —
      // the guard looks at the counter *before* this request, so the request
      // that pushes the count over the line is itself ungated.
      const crossing = await request(app).post('/api/auth/login').send({ username, password: 'wrong' });
      expect(crossing.status).toBe(401);

      // Next attempt (still no captcha_pass) is blocked before password is even checked.
      const blocked = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('CAPTCHA_REQUIRED');

      // A nonexistent username accumulating the same number of failures is gated
      // identically — proves captchaGuard runs ahead of db.select(users) in login.ts.
      const ghost = 'captcha_enforce_ghost';
      for (let i = 0; i < CAPTCHA_CONFIG.triggerThreshold; i++) {
        await request(app).post('/api/auth/login').send({ username: ghost, password: 'wrong' });
      }
      const ghostBlocked = await request(app).post('/api/auth/login').send({ username: ghost, password: 'wrong' });
      expect(ghostBlocked.status).toBe(403);
      expect(ghostBlocked.body.code).toBe('CAPTCHA_REQUIRED');
    });

    it('solving the real puzzle unblocks login with correct credentials', async () => {
      const username = 'captcha_enforce_b';
      await registerVerifiedUser(username);

      for (let i = 0; i < CAPTCHA_CONFIG.triggerThreshold; i++) {
        await request(app).post('/api/auth/login').send({ username, password: 'wrong' });
      }
      const stillBlocked = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
      expect(stillBlocked.status).toBe(403);
      expect(stillBlocked.body.code).toBe('CAPTCHA_REQUIRED');

      const captchaPass = await solveChallenge(username);

      const success = await request(app)
        .post('/api/auth/login')
        .send({ username, password: PASSWORD, captcha_pass: captchaPass });
      expect(success.status).toBe(200);
      expect(success.body.data).toHaveProperty('access_token');
    });

    it('rejects a misaligned solution and reports remaining attempts', async () => {
      const username = 'captcha_enforce_c';
      const challenge = await fetchChallenge(username);
      const wrongX = (challenge.piece_x + 40) % 260;

      const res = await request(app).post('/api/auth/captcha/verify').send({
        challenge_id: challenge.challenge_id,
        x: wrongX,
        trail: humanTrail(wrongX),
        input_mode: 'pointer',
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CAPTCHA_INVALID');
      expect(res.body.data.attempts_remaining).toBe(CAPTCHA_CONFIG.maxVerifyAttempts - 1);
    });

    it('rejects replay of an already-consumed captcha_pass', async () => {
      const username = 'captcha_enforce_d';
      await registerVerifiedUser(username);

      for (let i = 0; i < CAPTCHA_CONFIG.triggerThreshold; i++) {
        await request(app).post('/api/auth/login').send({ username, password: 'wrong' });
      }
      const captchaPass = await solveChallenge(username);

      // First use: wrong password, so login still fails — but the guard consumes
      // the one-time token before bcrypt ever runs.
      const firstUse = await request(app)
        .post('/api/auth/login')
        .send({ username, password: 'still-wrong', captcha_pass: captchaPass });
      expect(firstUse.status).toBe(401);

      // Replaying the same (already-burned) token, even with the correct password,
      // must be treated as if no token were presented at all.
      const replay = await request(app)
        .post('/api/auth/login')
        .send({ username, password: PASSWORD, captcha_pass: captchaPass });
      expect(replay.status).toBe(403);
      expect(replay.body.code).toBe('CAPTCHA_REQUIRED');
    });
  });

  describe('CAPTCHA_MODE=off', () => {
    beforeEach(() => {
      (config as any).CAPTCHA_MODE = 'off';
    });

    it('never blocks login regardless of failure count', async () => {
      const username = 'captcha_off_a';
      await registerVerifiedUser(username);

      // Stay under SECURITY_CONFIG.maxFailedAttempts (5) so the account-level
      // lockout doesn't kick in and mask what this test is actually checking.
      for (let i = 0; i < CAPTCHA_CONFIG.triggerThreshold + 1; i++) {
        const res = await request(app).post('/api/auth/login').send({ username, password: 'wrong' });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
      }

      const success = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
      expect(success.status).toBe(200);
    });
  });

  describe('CAPTCHA_MODE=shadow', () => {
    beforeEach(() => {
      (config as any).CAPTCHA_MODE = 'shadow';
    });

    it('crosses the threshold but never returns CAPTCHA_REQUIRED to the client', async () => {
      const username = 'captcha_shadow_a';
      await registerVerifiedUser(username);

      for (let i = 0; i < CAPTCHA_CONFIG.triggerThreshold; i++) {
        await request(app).post('/api/auth/login').send({ username, password: 'wrong' });
      }

      const res = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('access_token');
    });
  });
});
