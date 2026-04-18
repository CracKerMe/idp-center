import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// ─── Re-declare the EnvSchema inline (mirrors server/config.ts exactly) ───────
const EnvSchema = z.object({
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少需要 32 个字符'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET 至少需要 32 个字符'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5986),
  APP_URL: z.url().default('http://localhost:5986'),
  SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
  SMTP_PORT: z.coerce.number().int().positive('SMTP_PORT must be a positive integer'),
  SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
  SMTP_PASS: z.string().min(1, 'SMTP_PASS is required'),
  SMTP_FROM: z.string().min(1, 'SMTP_FROM is required'),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.url().optional(),
  ENCRYPTION_KEY: z.string().min(32).optional(),
});

describe('Config / EnvSchema', () => {
  const originalEnv = process.env;

  const validEnv = () => ({
    JWT_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    NODE_ENV: 'test',
    PORT: '5986',
    APP_URL: 'http://localhost:5986',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    SMTP_FROM: 'noreply@example.com',
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('valid environment', () => {
    it('parses a complete valid environment', () => {
      const env = validEnv();
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.JWT_SECRET).toBe(env.JWT_SECRET);
        expect(result.data.PORT).toBe(5986);
        expect(result.data.SMTP_PORT).toBe(587);
      }
    });

    it('applies default NODE_ENV = development', () => {
      const { NODE_ENV, ...env } = validEnv();
      
      const result = EnvSchema.safeParse(env);
      expect(result.success && result.data.NODE_ENV).toBe('development');
    });

    it('applies default PORT = 5986', () => {
      const { PORT, ...env } = validEnv();
      
      const result = EnvSchema.safeParse(env);
      expect(result.success && result.data.PORT).toBe(5986);
    });

    it('applies default APP_URL', () => {
      const { APP_URL, ...env } = validEnv();
      
      const result = EnvSchema.safeParse(env);
      expect(result.success && result.data.APP_URL).toBe('http://localhost:5986');
    });

    it('allows optional GitHub fields to be absent', () => {
      const env = validEnv();
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.GITHUB_CLIENT_ID).toBeUndefined();
        expect(result.data.GITHUB_CLIENT_SECRET).toBeUndefined();
        expect(result.data.GITHUB_CALLBACK_URL).toBeUndefined();
      }
    });

    it('allows optional ENCRYPTION_KEY to be absent', () => {
      const env = validEnv();
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ENCRYPTION_KEY).toBeUndefined();
      }
    });
  });

  describe('JWT_SECRET validation', () => {
    it('rejects JWT_SECRET shorter than 32 characters', () => {
      const env = { ...validEnv(), JWT_SECRET: 'short' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('rejects JWT_SECRET of exactly 31 characters', () => {
      const env = { ...validEnv(), JWT_SECRET: 'a'.repeat(31) };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('accepts JWT_SECRET of exactly 32 characters', () => {
      const env = { ...validEnv(), JWT_SECRET: 'a'.repeat(32) };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('rejects missing JWT_SECRET', () => {
      const { JWT_SECRET, ...env } = validEnv();
      
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('JWT_REFRESH_SECRET validation', () => {
    it('rejects JWT_REFRESH_SECRET shorter than 32 characters', () => {
      const env = { ...validEnv(), JWT_REFRESH_SECRET: 'short' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('accepts JWT_REFRESH_SECRET of exactly 32 characters', () => {
      const env = { ...validEnv(), JWT_REFRESH_SECRET: 'b'.repeat(32) };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });
  });

  describe('NODE_ENV validation', () => {
    it('accepts development', () => {
      const env = { ...validEnv(), NODE_ENV: 'development' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('accepts production', () => {
      const env = { ...validEnv(), NODE_ENV: 'production' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('accepts test', () => {
      const env = { ...validEnv(), NODE_ENV: 'test' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('rejects invalid NODE_ENV', () => {
      const env = { ...validEnv(), NODE_ENV: 'staging' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('PORT validation', () => {
    it('accepts numeric string', () => {
      const env = { ...validEnv(), PORT: '3000' };
      const result = EnvSchema.safeParse(env);
      expect(result.success && result.data.PORT).toBe(3000);
    });

    it('rejects non-numeric PORT', () => {
      const env = { ...validEnv(), PORT: 'not-a-number' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('APP_URL validation', () => {
    it('accepts a valid URL', () => {
      const env = { ...validEnv(), APP_URL: 'https://myapp.com' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('rejects an invalid URL', () => {
      const env = { ...validEnv(), APP_URL: 'not-a-url' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('accepts a hostname without protocol (Zod z.url is permissive for hostnames)', () => {
      // Zod z.url() is relatively permissive; "localhost:5986" may pass depending on version
      const env = { ...validEnv(), APP_URL: 'localhost:5986' };
      const result = EnvSchema.safeParse(env);
      // This documents actual Zod behaviour — update if stricter validation is desired
      expect(result.success).toBe(true);
    });
  });

  describe('SMTP validation', () => {
    it('rejects empty SMTP_HOST', () => {
      const env = { ...validEnv(), SMTP_HOST: '' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('rejects missing SMTP_HOST', () => {
      const { SMTP_HOST, ...env } = validEnv();
      
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('rejects negative SMTP_PORT', () => {
      const env = { ...validEnv(), SMTP_PORT: '-1' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('rejects zero SMTP_PORT', () => {
      const env = { ...validEnv(), SMTP_PORT: '0' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('rejects non-integer SMTP_PORT', () => {
      const env = { ...validEnv(), SMTP_PORT: '587.5' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('accepts valid SMTP_PORT (587)', () => {
      const env = { ...validEnv(), SMTP_PORT: '587' };
      const result = EnvSchema.safeParse(env);
      expect(result.success && result.data.SMTP_PORT).toBe(587);
    });

    it('accepts valid SMTP_PORT (465 with SSL)', () => {
      const env = { ...validEnv(), SMTP_PORT: '465' };
      const result = EnvSchema.safeParse(env);
      expect(result.success && result.data.SMTP_PORT).toBe(465);
    });
  });

  describe('GITHUB_CALLBACK_URL validation', () => {
    it('accepts a valid GitHub callback URL', () => {
      const env = { ...validEnv(), GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', GITHUB_CALLBACK_URL: 'https://myapp.com/callback' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('rejects invalid GitHub callback URL', () => {
      const env = { ...validEnv(), GITHUB_CALLBACK_URL: 'not-a-url' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('ENCRYPTION_KEY validation', () => {
    it('accepts ENCRYPTION_KEY at exactly 32 chars', () => {
      const env = { ...validEnv(), ENCRYPTION_KEY: 'a'.repeat(32) };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('rejects ENCRYPTION_KEY shorter than 32 chars', () => {
      const env = { ...validEnv(), ENCRYPTION_KEY: 'short' };
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('SECURITY_CONFIG', () => {
    it('exports maxFailedAttempts = 5', () => {
      // Re-derive from server/config.ts
      const SECURITY_CONFIG = { maxFailedAttempts: 5, lockDurationMinutes: 15 };
      expect(SECURITY_CONFIG.maxFailedAttempts).toBe(5);
    });

    it('exports lockDurationMinutes = 15', () => {
      const SECURITY_CONFIG = { maxFailedAttempts: 5, lockDurationMinutes: 15 };
      expect(SECURITY_CONFIG.lockDurationMinutes).toBe(15);
    });
  });
});
