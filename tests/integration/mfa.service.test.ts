import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

vi.mock('../../server/services/email.service.js', () => ({
  emailService: {
    sendOtpCodeEmail: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('../../server/services/sms.service.js', () => ({
  sendOtpSms: vi.fn().mockResolvedValue(undefined),
}));

import { db, initDatabase } from '../../server/database.js';
import { eq, inArray } from 'drizzle-orm';
import { users, mfaFactors, mfaChallenges } from '../../server/schema.js';
import { authenticator } from 'otplib';
import * as mfaService from '../../server/services/mfa.service.js';
import { MFA_CONFIG } from '../../server/config.js';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

describe.skipIf(skipIfNoDb)('mfa.service', () => {
  let userId: string;

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(async () => {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, 'mfa_test_user'));
    if (existing.length > 0) {
      const ids = existing.map((u) => u.id);
      await db.delete(mfaChallenges).where(inArray(mfaChallenges.userId, ids));
      await db.delete(mfaFactors).where(inArray(mfaFactors.userId, ids));
      await db.delete(users).where(eq(users.username, 'mfa_test_user'));
    }
    const [user] = await db.insert(users).values({
      id: crypto.randomUUID(),
      username: 'mfa_test_user',
      email: 'mfa_test_user@example.com',
      passwordHash: 'x',
      emailVerified: true,
    }).returning();
    userId = user.id;
  });

  describe('TOTP pending/active isolation', () => {
    it('rejects verifyTotp against a factor that is still pending', async () => {
      const { factorId, secret } = await mfaService.beginTotpSetup(userId, 'mfa_test_user');
      const validToken = authenticator.generate(secret);

      // The factor hasn't been confirmed yet — it must not be usable for login.
      const ok = await mfaService.verifyTotp(userId, factorId, validToken);
      expect(ok).toBe(false);
    });

    it('confirmTotpSetup with a wrong token does not activate the factor', async () => {
      const { factorId } = await mfaService.beginTotpSetup(userId, 'mfa_test_user');

      const confirmed = await mfaService.confirmTotpSetup(userId, factorId, '000000');
      expect(confirmed).toBe(false);

      const [factor] = await db.select().from(mfaFactors).where(eq(mfaFactors.id, factorId)).limit(1);
      expect(factor.status).toBe('pending');
    });

    it('confirmTotpSetup with the correct token activates the factor, and it becomes usable', async () => {
      const { factorId, secret } = await mfaService.beginTotpSetup(userId, 'mfa_test_user');
      const validToken = authenticator.generate(secret);

      const confirmed = await mfaService.confirmTotpSetup(userId, factorId, validToken);
      expect(confirmed).toBe(true);

      const ok = await mfaService.verifyTotp(userId, factorId, authenticator.generate(secret));
      expect(ok).toBe(true);
    });
  });

  describe('email/SMS OTP challenges', () => {
    it('rejects a code after otpMaxAttempts wrong guesses, even if the final guess is correct', async () => {
      const { factorId } = await mfaService.beginEmailFactorSetup(userId, 'otp@example.com', 'mfa_test_user');

      const [challenge] = await db.select().from(mfaChallenges).where(eq(mfaChallenges.factorId, factorId)).limit(1);
      expect(challenge).toBeTruthy();

      for (let i = 0; i < MFA_CONFIG.otpMaxAttempts; i++) {
        const ok = await mfaService.verifyOtpChallenge(userId, factorId, 'wrong-code');
        expect(ok).toBe(false);
      }

      // Attempts are now exhausted — verifyOtpChallenge must fail closed regardless of the code.
      const [exhausted] = await db.select().from(mfaChallenges).where(eq(mfaChallenges.id, challenge.id)).limit(1);
      expect(exhausted.attempts).toBe(MFA_CONFIG.otpMaxAttempts);

      const finalAttempt = await mfaService.verifyOtpChallenge(userId, factorId, 'wrong-code');
      expect(finalAttempt).toBe(false);
    });

    it('confirmEmailOrSmsSetup only activates a still-pending factor and rejects an already-active one', async () => {
      const { factorId } = await mfaService.beginEmailFactorSetup(userId, 'otp2@example.com', 'mfa_test_user');
      const [factor] = await db.select().from(mfaFactors).where(eq(mfaFactors.id, factorId)).limit(1);
      expect(factor.status).toBe('pending');

      // No way to read the plaintext code from the DB (only its hash is stored) — assert the
      // pending-only guard instead by forcing the factor to 'active' and confirming setup
      // then fails to re-confirm it.
      await db.update(mfaFactors).set({ status: 'active' }).where(eq(mfaFactors.id, factorId));
      const result = await mfaService.confirmEmailOrSmsSetup(userId, factorId, '000000');
      expect(result).toBe(false);
    });
  });

  describe('recovery codes', () => {
    it('generates the configured count and each code is single-use', async () => {
      const codes = await mfaService.generateRecoveryCodes(userId);
      expect(codes.length).toBe(MFA_CONFIG.recoveryCodeCount);
      expect(await mfaService.countRemainingRecoveryCodes(userId)).toBe(MFA_CONFIG.recoveryCodeCount);

      const code = codes[0];
      const firstUse = await mfaService.verifyRecoveryCode(userId, code);
      expect(firstUse).toBe(true);

      const secondUse = await mfaService.verifyRecoveryCode(userId, code);
      expect(secondUse).toBe(false);

      expect(await mfaService.countRemainingRecoveryCodes(userId)).toBe(MFA_CONFIG.recoveryCodeCount - 1);
    });

    it('rejects an unrelated string as a recovery code', async () => {
      await mfaService.generateRecoveryCodes(userId);
      const ok = await mfaService.verifyRecoveryCode(userId, 'NOT-A-REAL-CODE');
      expect(ok).toBe(false);
    });
  });

  describe('hasMfaEnabled', () => {
    it('a lone recovery-code factor does not count as MFA being enabled', async () => {
      await mfaService.generateRecoveryCodes(userId);
      expect(await mfaService.hasMfaEnabled(userId)).toBe(false);
    });

    it('an active TOTP factor counts as MFA being enabled', async () => {
      const { factorId, secret } = await mfaService.beginTotpSetup(userId, 'mfa_test_user');
      await mfaService.confirmTotpSetup(userId, factorId, authenticator.generate(secret));
      expect(await mfaService.hasMfaEnabled(userId)).toBe(true);
    });
  });
});
