import { describe, it, expect } from 'vitest';
import {
  updateProfileSchema,
  changePasswordSchema,
  deleteAccountSchema,
  cancelDeletionSchema,
  sessionIdParamsSchema,
  deviceIdParamsSchema,
} from '../server/validators/user.validator.js';

describe('User Validators', () => {
  describe('updateProfileSchema', () => {
    it('accepts empty object (all fields optional)', () => {
      const result = updateProfileSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts full_name only', () => {
      const result = updateProfileSchema.safeParse({ full_name: 'John Doe' });
      expect(result.success).toBe(true);
    });

    it('accepts phone only', () => {
      const result = updateProfileSchema.safeParse({ phone: '+1234567890' });
      expect(result.success).toBe(true);
    });

    it('accepts email only', () => {
      const result = updateProfileSchema.safeParse({ email: 'new@example.com' });
      expect(result.success).toBe(true);
    });

    it('accepts all fields at once', () => {
      const result = updateProfileSchema.safeParse({
        full_name: 'John Doe',
        phone: '+1234567890',
        email: 'john@example.com',
      });
      expect(result.success).toBe(true);
    });

    it('rejects full_name longer than 100 characters', () => {
      const result = updateProfileSchema.safeParse({ full_name: 'A'.repeat(101) });
      expect(result.success).toBe(false);
    });

    it('accepts full_name at exactly 100 characters', () => {
      const result = updateProfileSchema.safeParse({ full_name: 'A'.repeat(100) });
      expect(result.success).toBe(true);
    });

    it('rejects phone longer than 20 characters', () => {
      const result = updateProfileSchema.safeParse({ phone: '1'.repeat(21) });
      expect(result.success).toBe(false);
    });

    it('accepts phone at exactly 20 characters', () => {
      const result = updateProfileSchema.safeParse({ phone: '1'.repeat(20) });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email format', () => {
      const result = updateProfileSchema.safeParse({ email: 'not-valid' });
      expect(result.success).toBe(false);
    });

    it('accepts unknown fields (Zod objects are passthrough by default)', () => {
      // The schema uses z.object({...}) without .strict(), so extra fields are accepted
      const result = updateProfileSchema.safeParse({ username: 'hacker' } as any);
      expect(result.success).toBe(true);
    });
  });

  describe('changePasswordSchema', () => {
    it('accepts valid current and new passwords', () => {
      const result = changePasswordSchema.safeParse({ current_password: 'OldPass1!', new_password: 'NewPass2@' });
      expect(result.success).toBe(true);
    });

    it('rejects missing current_password', () => {
      const result = changePasswordSchema.safeParse({ new_password: 'NewPass2@' });
      expect(result.success).toBe(false);
    });

    it('rejects empty current_password', () => {
      const result = changePasswordSchema.safeParse({ current_password: '', new_password: 'NewPass2@' });
      expect(result.success).toBe(false);
    });

    it('rejects missing new_password', () => {
      const result = changePasswordSchema.safeParse({ current_password: 'OldPass1!' });
      expect(result.success).toBe(false);
    });

    it('rejects new_password shorter than 8 characters', () => {
      const result = changePasswordSchema.safeParse({ current_password: 'OldPass1!', new_password: 'short' });
      expect(result.success).toBe(false);
    });

    it('accepts new_password at exactly 8 characters', () => {
      const result = changePasswordSchema.safeParse({ current_password: 'OldPass1!', new_password: '12345678' });
      expect(result.success).toBe(true);
    });

    it('rejects new_password longer than 128 characters', () => {
      const result = changePasswordSchema.safeParse({ current_password: 'OldPass1!', new_password: 'A'.repeat(129) });
      expect(result.success).toBe(false);
    });
  });

  describe('deleteAccountSchema', () => {
    it('accepts a password', () => {
      const result = deleteAccountSchema.safeParse({ password: 'MyPassword123!' });
      expect(result.success).toBe(true);
    });

    it('rejects empty password', () => {
      const result = deleteAccountSchema.safeParse({ password: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing password', () => {
      const result = deleteAccountSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('cancelDeletionSchema', () => {
    it('accepts empty object', () => {
      const result = cancelDeletionSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('sessionIdParamsSchema', () => {
    it('accepts a valid UUID v4', () => {
      const result = sessionIdParamsSchema.safeParse({ sessionId: '550e8400-e29b-41d4-a716-446655440000' });
      expect(result.success).toBe(true);
    });

    it('rejects a UUID without dashes (commonSchemas.id requires RFC-4122 format)', () => {
      // z.string().uuid() only accepts the dash-separated format
      const result = sessionIdParamsSchema.safeParse({ sessionId: '550e8400e29b41d4a716446655440000' });
      expect(result.success).toBe(false);
    });

    it('rejects a non-UUID string', () => {
      const result = sessionIdParamsSchema.safeParse({ sessionId: 'not-a-uuid' });
      expect(result.success).toBe(false);
    });

    it('rejects a number', () => {
      const result = sessionIdParamsSchema.safeParse({ sessionId: 123 } as any);
      expect(result.success).toBe(false);
    });

    it('rejects empty string', () => {
      const result = sessionIdParamsSchema.safeParse({ sessionId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing sessionId', () => {
      const result = sessionIdParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('deviceIdParamsSchema', () => {
    it('accepts a valid UUID', () => {
      const result = deviceIdParamsSchema.safeParse({ deviceId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' });
      expect(result.success).toBe(true);
    });

    it('rejects a non-UUID string', () => {
      const result = deviceIdParamsSchema.safeParse({ deviceId: 'my-device' });
      expect(result.success).toBe(false);
    });

    it('rejects missing deviceId', () => {
      const result = deviceIdParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
