import { describe, it, expect } from 'vitest';
import { validate, commonSchemas } from '../server/middleware/validate.js';
import { z } from 'zod';

describe('Validation Middleware', () => {
  describe('commonSchemas', () => {
    it('validates valid username', () => {
      const result = commonSchemas.username.safeParse('valid-user123');
      expect(result.success).toBe(true);
    });

    it('rejects username with invalid characters', () => {
      const result = commonSchemas.username.safeParse('invalid user!');
      expect(result.success).toBe(false);
    });

    it('rejects short username', () => {
      const result = commonSchemas.username.safeParse('ab');
      expect(result.success).toBe(false);
    });

    it('validates valid email', () => {
      const result = commonSchemas.email.safeParse('test@example.com');
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = commonSchemas.email.safeParse('invalid-email');
      expect(result.success).toBe(false);
    });

    it('validates valid password', () => {
      const result = commonSchemas.password.safeParse('password123');
      expect(result.success).toBe(true);
    });

    it('rejects short password', () => {
      const result = commonSchemas.password.safeParse('short');
      expect(result.success).toBe(false);
    });

    it('validates valid OTP', () => {
      const result = commonSchemas.otp.safeParse('123456');
      expect(result.success).toBe(true);
    });

    it('rejects OTP with letters', () => {
      const result = commonSchemas.otp.safeParse('12345a');
      expect(result.success).toBe(false);
    });

    it('rejects OTP with wrong length', () => {
      const result = commonSchemas.otp.safeParse('12345');
      expect(result.success).toBe(false);
    });
  });

  describe('validate middleware', () => {
    const mockReq = (body: any = {}, query: any = {}, params: any = {}) => ({ body, query, params });
    const mockRes = () => {
      const res: any = {};
      res.status = (code: number) => { res.statusCode = code; return res; };
      res.json = (data: any) => { res.data = data; return res; };
      return res;
    };
    const mockNext = () => ({ called: false });

    it('passes validation with valid body', () => {
      const schema = { body: z.object({ name: z.string() }) };
      const req = mockReq({ name: 'test' });
      const res = mockRes();
      const next = mockNext();

      validate(schema)(req as any, res as any, () => { next.called = true; });

      expect(res.statusCode).toBeUndefined();
    });

    it('fails validation with invalid body', () => {
      const schema = { body: z.object({ name: z.string() }) };
      const req = mockReq({ name: 123 });
      const res = mockRes();
      const next = mockNext();

      validate(schema)(req as any, res as any, () => { next.called = true; });

      expect(res.statusCode).toBe(400);
      expect(res.data.error).toBe('Validation failed');
      expect(res.data.code).toBe('VALIDATION_ERROR');
      expect(res.data.details).toBeDefined();
    });

    it('validates query parameters', () => {
      const schema = { query: z.object({ page: commonSchemas.page }) };
      const req = mockReq({}, { page: '2' });
      const res = mockRes();
      const next = mockNext();

      validate(schema)(req as any, res as any, () => { next.called = true; });

      expect(res.statusCode).toBeUndefined();
    });

    it('validates route params', () => {
      const schema = { params: z.object({ id: commonSchemas.id }) };
      const req = mockReq({}, {}, { id: '550e8400-e29b-41d4-a716-446655440000' });
      const res = mockRes();
      const next = mockNext();

      validate(schema)(req as any, res as any, () => { next.called = true; });

      expect(res.statusCode).toBeUndefined();
    });

    it('rejects invalid UUID', () => {
      const schema = { params: z.object({ id: commonSchemas.id }) };
      const req = mockReq({}, {}, { id: 'not-a-uuid' });
      const res = mockRes();
      const next = mockNext();

      validate(schema)(req as any, res as any, () => { next.called = true; });

      expect(res.statusCode).toBe(400);
    });
  });
});
