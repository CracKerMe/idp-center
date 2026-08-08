/**
 * Unified API Response Format
 * Standard: { message, data, error, code }
 * - code: 0 = success, other values = error codes
 */

export interface ApiResponse<T = unknown> {
  message?: string;
  data?: T;
  error?: string;
  code?: number | string;
}

/** Success code constant */
export const SUCCESS_CODE = 0;

/**
 * Success response helper
 */
export function success<T>(data: T, message?: string): ApiResponse<T> {
  const response: ApiResponse<T> = { 
    data,
    code: SUCCESS_CODE 
  };
  if (message) response.message = message;
  return response;
}

/**
 * Error response helper
 */
export function error(errorMsg: string, code?: string): ApiResponse {
  const response: ApiResponse = { error: errorMsg };
  if (code) response.code = code;
  return response;
}

/**
 * Message-only response helper
 */
export function message(msg: string): ApiResponse {
  return { 
    message: msg, 
    code: SUCCESS_CODE 
  };
}

/**
 * Paginated response helper
 */
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number
): ApiResponse<PaginatedData<T>> {
  return {
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
    code: SUCCESS_CODE,
  };
}

/**
 * Error codes enumeration
 * - Success: 0
 * - Errors: string codes for identification
 */
export enum ErrorCode {
  // Authentication errors (AUTH_*)
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_REVOKED = 'AUTH_TOKEN_REVOKED',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_OTP_REQUIRED = 'AUTH_OTP_REQUIRED',
  AUTH_OTP_INVALID = 'AUTH_OTP_INVALID',
  AUTH_MFA_REQUIRED = 'AUTH_MFA_REQUIRED',
  AUTH_MFA_TOKEN_INVALID = 'AUTH_MFA_TOKEN_INVALID',
  AUTH_RISK_DENIED = 'AUTH_RISK_DENIED',
  CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED',
  CAPTCHA_INVALID = 'CAPTCHA_INVALID',
  CAPTCHA_EXPIRED = 'CAPTCHA_EXPIRED',

  // Account errors (ACCOUNT_*)
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_PENDING_DELETION = 'ACCOUNT_PENDING_DELETION',
  ACCOUNT_NOT_VERIFIED = 'ACCOUNT_NOT_VERIFIED',
  
  // Validation errors (VALIDATION_*)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  VALIDATION_PASSWORD_WEAK = 'VALIDATION_PASSWORD_WEAK',
  VALIDATION_REQUIRED = 'VALIDATION_REQUIRED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  
  // Token errors (TOKEN_*)
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  TOKEN_ALREADY_USED = 'TOKEN_ALREADY_USED',
  
  // Resource errors (RESOURCE_*)
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  
  // Server errors (SERVER_*)
  SERVER_ERROR = 'SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  FEATURE_DISABLED = 'FEATURE_DISABLED',
  DEPENDENCY_VIOLATION = 'DEPENDENCY_VIOLATION',
  RATE_LIMITED = 'RATE_LIMITED',

  // Password policy errors (PASSWORD_*)
  PASSWORD_MISSING_UPPERCASE = 'PASSWORD_MISSING_UPPERCASE',
  PASSWORD_MISSING_LOWERCASE = 'PASSWORD_MISSING_LOWERCASE',
  PASSWORD_MISSING_DIGIT = 'PASSWORD_MISSING_DIGIT',
  PASSWORD_MISSING_SPECIAL = 'PASSWORD_MISSING_SPECIAL',
  PASSWORD_TOO_SHORT = 'PASSWORD_TOO_SHORT',
  PASSWORD_TOO_COMMON = 'PASSWORD_TOO_COMMON',
  PASSWORD_RECENTLY_USED = 'PASSWORD_RECENTLY_USED',
  PASSWORD_EXPIRED = 'PASSWORD_EXPIRED',

  // IP whitelist errors (IP_*)
  IP_NOT_WHITELISTED = 'IP_NOT_WHITELISTED',
  INVALID_CIDR_FORMAT = 'INVALID_CIDR_FORMAT',
  CIDR_ALREADY_EXISTS = 'CIDR_ALREADY_EXISTS',
}

/**
 * Express response helpers extension
 */
declare global {
  namespace Express {
    interface Response {
      apiSuccess<T>(data: T, message?: string): void;
      apiError(errorMsg: string, statusCode: number, code?: string): void;
      apiMessage(msg: string): void;
    }
  }
}
