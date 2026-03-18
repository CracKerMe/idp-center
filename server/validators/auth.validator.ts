/**
 * Authentication Validators
 * Zod schemas for authentication-related API endpoints
 */

import { z } from 'zod';
import { commonSchemas } from '../middleware/validate.js';

// Registration schema
export const registerSchema = z.object({
  username: commonSchemas.username,
  email: commonSchemas.email,
  password: commonSchemas.password,
});

export type RegisterInput = z.infer<typeof registerSchema>;

// Login schema
export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  otp: commonSchemas.otp.optional(),
  remember_me: z.boolean().optional(),
  trust_device: z.boolean().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

// OTP setup schema
export const otpSetupSchema = z.object({});

// OTP verify schema
export const otpVerifySchema = z.object({
  token: commonSchemas.otp,
});

export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

// Password validation schema
export const passwordValidateSchema = z.object({
  password: commonSchemas.password,
});

// Email verification schema
export const emailVerifySchema = z.object({
  token: commonSchemas.token,
});

export type EmailVerifyInput = z.infer<typeof emailVerifySchema>;

// Email resend public schema
export const emailResendPublicSchema = z.object({
  email: commonSchemas.email.optional(),
  username: z.string().min(1).optional(),
}).refine(data => data.email || data.username, {
  message: 'Either email or username is required',
});

// Password reset request schema
export const passwordResetRequestSchema = z.object({
  email: commonSchemas.email,
});

// Password reset verify schema
export const passwordResetVerifySchema = z.object({
  token: commonSchemas.token,
});

// Password reset schema
export const passwordResetSchema = z.object({
  token: commonSchemas.token,
  new_password: commonSchemas.password,
});

export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

// Token refresh schema
export const tokenRefreshSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export type TokenRefreshInput = z.infer<typeof tokenRefreshSchema>;

// Logout schema
export const logoutSchema = z.object({});

// Password change schema
export const passwordChangeSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: commonSchemas.password,
});

export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
