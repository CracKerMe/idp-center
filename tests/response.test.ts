import { describe, it, expect } from 'vitest';
import { success, error, message, paginated, ErrorCode, SUCCESS_CODE } from '../server/utils/response.js';

describe('Response Utils', () => {
  describe('success', () => {
    it('creates a success response with data only', () => {
      const response = success({ id: 1, name: 'test' });
      expect(response).toEqual({
        data: { id: 1, name: 'test' },
        code: 0,
      });
    });

    it('creates a success response with data and message', () => {
      const response = success({ id: 1 }, 'Created successfully');
      expect(response).toEqual({
        data: { id: 1 },
        message: 'Created successfully',
        code: 0,
      });
    });

    it('creates a success response with null data', () => {
      const response = success(null);
      expect(response).toEqual({ 
        data: null, 
        code: 0,
      });
    });

    it('creates a success response with array data', () => {
      const response = success([1, 2, 3]);
      expect(response).toEqual({ 
        data: [1, 2, 3],
        code: 0,
      });
    });

    it('always includes code field as 0', () => {
      const response = success({ foo: 'bar' });
      expect(response.code).toBe(0);
    });
  });

  describe('error', () => {
    it('creates an error response with message only', () => {
      const response = error('Something went wrong');
      expect(response).toEqual({
        error: 'Something went wrong',
      });
    });

    it('creates an error response with message and code', () => {
      const response = error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS);
      expect(response).toEqual({
        error: 'Invalid credentials',
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });
    });

    it('error response does not have default code', () => {
      const response = error('Some error');
      expect(response.code).toBeUndefined();
    });

    it('error code is a string', () => {
      const response = error('Error', ErrorCode.AUTH_INVALID_CREDENTIALS);
      expect(typeof response.code).toBe('string');
    });
  });

  describe('message', () => {
    it('creates a message-only response', () => {
      const response = message('Operation completed');
      expect(response).toEqual({
        message: 'Operation completed',
        code: 0,
      });
    });

    it('message response always includes code 0', () => {
      const response = message('Done');
      expect(response.code).toBe(0);
    });
  });

  describe('paginated', () => {
    it('creates a paginated response', () => {
      const items = [{ id: 1 }, { id: 2 }];
      const response = paginated(items, 100, 2, 10);
      
      expect(response).toEqual({
        data: {
          items: [{ id: 1 }, { id: 2 }],
          total: 100,
          page: 2,
          pageSize: 10,
          totalPages: 10,
        },
        code: 0,
      });
    });

    it('calculates total pages correctly with rounding', () => {
      const response = paginated([], 95, 1, 10);
      expect(response.data?.totalPages).toBe(10);
    });

    it('handles empty items', () => {
      const response = paginated([], 0, 1, 10);
      expect(response.data?.totalPages).toBe(0);
    });

    it('paginated response always includes code 0', () => {
      const response = paginated([], 0, 1, 10);
      expect(response.code).toBe(0);
    });
  });

  describe('SUCCESS_CODE constant', () => {
    it('is 0', () => {
      expect(SUCCESS_CODE).toBe(0);
    });
  });

  describe('ErrorCode enum', () => {
    it('has authentication error codes', () => {
      expect(ErrorCode.AUTH_INVALID_CREDENTIALS).toBe('AUTH_INVALID_CREDENTIALS');
      expect(ErrorCode.AUTH_TOKEN_EXPIRED).toBe('AUTH_TOKEN_EXPIRED');
      expect(ErrorCode.AUTH_TOKEN_REVOKED).toBe('AUTH_TOKEN_REVOKED');
      expect(ErrorCode.AUTH_UNAUTHORIZED).toBe('AUTH_UNAUTHORIZED');
      expect(ErrorCode.AUTH_OTP_REQUIRED).toBe('AUTH_OTP_REQUIRED');
      expect(ErrorCode.AUTH_OTP_INVALID).toBe('AUTH_OTP_INVALID');
    });

    it('has account error codes', () => {
      expect(ErrorCode.ACCOUNT_DISABLED).toBe('ACCOUNT_DISABLED');
      expect(ErrorCode.ACCOUNT_LOCKED).toBe('ACCOUNT_LOCKED');
      expect(ErrorCode.ACCOUNT_PENDING_DELETION).toBe('ACCOUNT_PENDING_DELETION');
      expect(ErrorCode.ACCOUNT_NOT_VERIFIED).toBe('ACCOUNT_NOT_VERIFIED');
    });

    it('has validation error codes', () => {
      expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ErrorCode.VALIDATION_PASSWORD_WEAK).toBe('VALIDATION_PASSWORD_WEAK');
      expect(ErrorCode.VALIDATION_REQUIRED).toBe('VALIDATION_REQUIRED');
      expect(ErrorCode.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
    });

    it('has token error codes', () => {
      expect(ErrorCode.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
      expect(ErrorCode.TOKEN_INVALID).toBe('TOKEN_INVALID');
      expect(ErrorCode.TOKEN_REVOKED).toBe('TOKEN_REVOKED');
      expect(ErrorCode.TOKEN_ALREADY_USED).toBe('TOKEN_ALREADY_USED');
    });

    it('has resource error codes', () => {
      expect(ErrorCode.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND');
      expect(ErrorCode.RESOURCE_ALREADY_EXISTS).toBe('RESOURCE_ALREADY_EXISTS');
    });

    it('has server error codes', () => {
      expect(ErrorCode.SERVER_ERROR).toBe('SERVER_ERROR');
      expect(ErrorCode.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
      expect(ErrorCode.RATE_LIMITED).toBe('RATE_LIMITED');
    });
  });
});
