import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  otpVerifySchema,
  passwordValidateSchema,
  emailVerifySchema,
  emailResendPublicSchema,
  passwordResetRequestSchema,
  passwordResetVerifySchema,
  passwordResetSchema,
  tokenRefreshSchema,
  passwordChangeSchema,
} from '../server/validators/auth.validator.js';

describe('Auth Validators', () => {
  describe('registerSchema', () => {
    it('accepts valid registration input', () => {
      const input = { username: 'testuser', email: 'test@example.com', password: 'Password123!' };
      const result = registerSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects username that is too short', () => {
      const result = registerSchema.safeParse({ username: 'ab', email: 'test@example.com', password: 'Password123!' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid email', () => {
      const result = registerSchema.safeParse({ username: 'testuser', email: 'not-an-email', password: 'Password123!' });
      expect(result.success).toBe(false);
    });

    it('rejects password that is too weak', () => {
      const result = registerSchema.safeParse({ username: 'testuser', email: 'test@example.com', password: 'abc' });
      expect(result.success).toBe(false);
    });

    it('rejects missing username', () => {
      const result = registerSchema.safeParse({ email: 'test@example.com', password: 'Password123!' });
      expect(result.success).toBe(false);
    });

    it('rejects missing email', () => {
      const result = registerSchema.safeParse({ username: 'testuser', password: 'Password123!' });
      expect(result.success).toBe(false);
    });

    it('rejects missing password', () => {
      const result = registerSchema.safeParse({ username: 'testuser', email: 'test@example.com' });
      expect(result.success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('accepts username and password only', () => {
      const result = loginSchema.safeParse({ username: 'admin', password: 'secret' });
      expect(result.success).toBe(true);
    });

    it('accepts login with OTP', () => {
      const result = loginSchema.safeParse({ username: 'admin', password: 'secret', otp: '123456' });
      expect(result.success).toBe(true);
    });

    it('accepts login with remember_me', () => {
      const result = loginSchema.safeParse({ username: 'admin', password: 'secret', remember_me: true });
      expect(result.success).toBe(true);
    });

    it('accepts login with all optional fields', () => {
      const result = loginSchema.safeParse({
        username: 'admin',
        password: 'secret',
        otp: '123456',
        remember_me: true,
        trust_device: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing username', () => {
      const result = loginSchema.safeParse({ password: 'secret' });
      expect(result.success).toBe(false);
    });

    it('rejects missing password', () => {
      const result = loginSchema.safeParse({ username: 'admin' });
      expect(result.success).toBe(false);
    });

    it('rejects empty username', () => {
      const result = loginSchema.safeParse({ username: '', password: 'secret' });
      expect(result.success).toBe(false);
    });

    it('rejects empty password', () => {
      const result = loginSchema.safeParse({ username: 'admin', password: '' });
      expect(result.success).toBe(false);
    });

    it('accepts valid 6-digit OTP', () => {
      const result = loginSchema.safeParse({ username: 'admin', password: 'secret', otp: '000000' });
      expect(result.success).toBe(true);
    });

    it('rejects OTP with wrong length', () => {
      const result = loginSchema.safeParse({ username: 'admin', password: 'secret', otp: '12345' });
      expect(result.success).toBe(false);
    });
  });

  describe('otpVerifySchema', () => {
    it('accepts valid 6-digit OTP', () => {
      const result = otpVerifySchema.safeParse({ token: '123456' });
      expect(result.success).toBe(true);
    });

    it('rejects OTP with letters', () => {
      const result = otpVerifySchema.safeParse({ token: '12345a' });
      expect(result.success).toBe(false);
    });

    it('rejects OTP shorter than 6 digits', () => {
      const result = otpVerifySchema.safeParse({ token: '12345' });
      expect(result.success).toBe(false);
    });

    it('rejects OTP longer than 6 digits', () => {
      const result = otpVerifySchema.safeParse({ token: '1234567' });
      expect(result.success).toBe(false);
    });

    it('rejects missing token', () => {
      const result = otpVerifySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('passwordValidateSchema', () => {
    it('accepts strong password', () => {
      const result = passwordValidateSchema.safeParse({ password: 'StrongPass1!' });
      expect(result.success).toBe(true);
    });

    it('rejects weak password', () => {
      const result = passwordValidateSchema.safeParse({ password: 'weak' });
      expect(result.success).toBe(false);
    });

    it('accepts password without special characters (commonSchemas.password has no special-char rule)', () => {
      // commonSchemas.password = z.string().min(8).max(128) — special chars are not required at schema level
      const result = passwordValidateSchema.safeParse({ password: 'NoSpecial1' });
      expect(result.success).toBe(true);
    });
  });

  describe('emailVerifySchema', () => {
    it('accepts a token string', () => {
      const result = emailVerifySchema.safeParse({ token: 'abc123def456' });
      expect(result.success).toBe(true);
    });

    it('rejects empty token', () => {
      const result = emailVerifySchema.safeParse({ token: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('emailResendPublicSchema', () => {
    it('accepts when email is provided', () => {
      const result = emailResendPublicSchema.safeParse({ email: 'test@example.com' });
      expect(result.success).toBe(true);
    });

    it('accepts when username is provided', () => {
      const result = emailResendPublicSchema.safeParse({ username: 'testuser' });
      expect(result.success).toBe(true);
    });

    it('accepts when both email and username are provided', () => {
      const result = emailResendPublicSchema.safeParse({ email: 'test@example.com', username: 'testuser' });
      expect(result.success).toBe(true);
    });

    it('rejects when neither email nor username is provided', () => {
      const result = emailResendPublicSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects invalid email format', () => {
      const result = emailResendPublicSchema.safeParse({ email: 'not-valid' });
      expect(result.success).toBe(false);
    });
  });

  describe('passwordResetRequestSchema', () => {
    it('accepts valid email', () => {
      const result = passwordResetRequestSchema.safeParse({ email: 'user@example.com' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = passwordResetRequestSchema.safeParse({ email: 'not-email' });
      expect(result.success).toBe(false);
    });
  });

  describe('passwordResetVerifySchema', () => {
    it('accepts a token', () => {
      const result = passwordResetVerifySchema.safeParse({ token: 'some-reset-token' });
      expect(result.success).toBe(true);
    });

    it('rejects empty token', () => {
      const result = passwordResetVerifySchema.safeParse({ token: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('passwordResetSchema', () => {
    it('accepts valid token and new password', () => {
      const result = passwordResetSchema.safeParse({ token: 'reset-token', new_password: 'NewPass123!' });
      expect(result.success).toBe(true);
    });

    it('rejects weak new password', () => {
      const result = passwordResetSchema.safeParse({ token: 'reset-token', new_password: 'weak' });
      expect(result.success).toBe(false);
    });

    it('rejects missing token', () => {
      const result = passwordResetSchema.safeParse({ new_password: 'NewPass123!' });
      expect(result.success).toBe(false);
    });
  });

  describe('tokenRefreshSchema', () => {
    it('accepts a non-empty refresh token', () => {
      const result = tokenRefreshSchema.safeParse({ refresh_token: 'abc123' });
      expect(result.success).toBe(true);
    });

    it('rejects empty refresh token', () => {
      const result = tokenRefreshSchema.safeParse({ refresh_token: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing refresh token', () => {
      const result = tokenRefreshSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('passwordChangeSchema', () => {
    it('accepts valid current and new passwords', () => {
      const result = passwordChangeSchema.safeParse({ current_password: 'OldPass1!', new_password: 'NewPass2@' });
      expect(result.success).toBe(true);
    });

    it('rejects missing current_password', () => {
      const result = passwordChangeSchema.safeParse({ new_password: 'NewPass2@' });
      expect(result.success).toBe(false);
    });

    it('rejects weak new password', () => {
      const result = passwordChangeSchema.safeParse({ current_password: 'OldPass1!', new_password: 'short' });
      expect(result.success).toBe(false);
    });
  });
});
