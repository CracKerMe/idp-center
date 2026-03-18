/**
 * User Validators
 * Zod schemas for user-related API endpoints
 */

import { z } from 'zod';
import { commonSchemas } from '../middleware/validate.js';

// Update profile schema
export const updateProfileSchema = z.object({
  full_name: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Change password schema
export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8).max(128),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// Delete account schema
export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

// Cancel deletion schema
export const cancelDeletionSchema = z.object({});

// Session ID params schema
export const sessionIdParamsSchema = z.object({
  sessionId: commonSchemas.id,
});

// Trusted device ID params schema
export const deviceIdParamsSchema = z.object({
  deviceId: commonSchemas.id,
});
