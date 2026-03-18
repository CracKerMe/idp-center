/**
 * Admin Validators
 * Zod schemas for admin-related API endpoints
 */

import { z } from 'zod';
import { commonSchemas } from '../middleware/validate.js';

// User ID params schema
export const userIdParamsSchema = z.object({
  userId: commonSchemas.id,
});

// Update user schema (admin)
export const adminUpdateUserSchema = z.object({
  username: commonSchemas.username.optional(),
  email: commonSchemas.email.optional(),
  full_name: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  is_active: z.boolean().optional(),
  is_admin: z.boolean().optional(),
  tenant_id: z.string().optional(),
});

export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

// Create user schema (admin)
export const adminCreateUserSchema = z.object({
  username: commonSchemas.username,
  email: commonSchemas.email,
  password: commonSchemas.password,
  full_name: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  is_admin: z.boolean().optional(),
  tenant_id: z.string().optional(),
});

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

// Client ID params schema
export const clientIdParamsSchema = z.object({
  clientId: z.string().min(1),
});

// Create client schema
export const createClientSchema = z.object({
  client_name: z.string().min(1).max(100),
  redirect_uris: z.string().min(1),
  grant_types: z.string().default('authorization_code'),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;

// Update client schema
export const updateClientSchema = z.object({
  client_name: z.string().min(1).max(100).optional(),
  redirect_uris: z.string().min(1).optional(),
  grant_types: z.string().optional(),
  is_active: z.boolean().optional(),
});

export type UpdateClientInput = z.infer<typeof updateClientSchema>;

// List users query schema
export const listUsersQuerySchema = z.object({
  page: commonSchemas.page,
  pageSize: commonSchemas.pageSize,
  search: z.string().optional(),
  tenant_id: z.string().optional(),
  is_active: z.coerce.boolean().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

// Tenant ID params schema
export const tenantIdParamsSchema = z.object({
  tenantId: z.string().min(1),
});

// Create tenant schema
export const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

// Update tenant schema
export const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  domain: z.string().optional(),
  is_active: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
