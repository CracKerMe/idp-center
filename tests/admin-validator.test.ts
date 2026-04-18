import { describe, it, expect } from 'vitest';
import {
  userIdParamsSchema,
  adminUpdateUserSchema,
  adminCreateUserSchema,
  clientIdParamsSchema,
  createClientSchema,
  updateClientSchema,
  listUsersQuerySchema,
  tenantIdParamsSchema,
  createTenantSchema,
  updateTenantSchema,
} from '../server/validators/admin.validator.js';

describe('Admin Validators', () => {
  describe('userIdParamsSchema', () => {
    it('accepts a valid UUID', () => {
      const result = userIdParamsSchema.safeParse({ userId: '550e8400-e29b-41d4-a716-446655440000' });
      expect(result.success).toBe(true);
    });

    it('rejects a non-UUID string', () => {
      const result = userIdParamsSchema.safeParse({ userId: 'admin' });
      expect(result.success).toBe(false);
    });

    it('rejects missing userId', () => {
      const result = userIdParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('adminUpdateUserSchema', () => {
    it('accepts empty object', () => {
      const result = adminUpdateUserSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts valid username only', () => {
      const result = adminUpdateUserSchema.safeParse({ username: 'newuser' });
      expect(result.success).toBe(true);
    });

    it('accepts valid email only', () => {
      const result = adminUpdateUserSchema.safeParse({ email: 'user@example.com' });
      expect(result.success).toBe(true);
    });

    it('accepts is_active boolean', () => {
      const result = adminUpdateUserSchema.safeParse({ is_active: false });
      expect(result.success).toBe(true);
    });

    it('accepts is_admin boolean', () => {
      const result = adminUpdateUserSchema.safeParse({ is_admin: true });
      expect(result.success).toBe(true);
    });

    it('accepts all fields together', () => {
      const result = adminUpdateUserSchema.safeParse({
        username: 'newuser',
        email: 'new@example.com',
        full_name: 'New User',
        phone: '+1234567890',
        is_active: true,
        is_admin: false,
        tenant_id: 'tenant-1',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = adminUpdateUserSchema.safeParse({ email: 'not-email' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid username characters', () => {
      const result = adminUpdateUserSchema.safeParse({ username: 'user name!' });
      expect(result.success).toBe(false);
    });

    it('rejects full_name longer than 100 chars', () => {
      const result = adminUpdateUserSchema.safeParse({ full_name: 'A'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  describe('adminCreateUserSchema', () => {
    it('accepts minimal valid input', () => {
      const result = adminCreateUserSchema.safeParse({
        username: 'newuser',
        email: 'new@example.com',
        password: 'Password123!',
      });
      expect(result.success).toBe(true);
    });

    it('accepts all optional fields', () => {
      const result = adminCreateUserSchema.safeParse({
        username: 'newuser',
        email: 'new@example.com',
        password: 'Password123!',
        full_name: 'Full Name',
        phone: '+1234567890',
        is_admin: true,
        tenant_id: 'custom-tenant',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing username', () => {
      const result = adminCreateUserSchema.safeParse({ email: 'new@example.com', password: 'Password123!' });
      expect(result.success).toBe(false);
    });

    it('rejects missing email', () => {
      const result = adminCreateUserSchema.safeParse({ username: 'newuser', password: 'Password123!' });
      expect(result.success).toBe(false);
    });

    it('rejects missing password', () => {
      const result = adminCreateUserSchema.safeParse({ username: 'newuser', email: 'new@example.com' });
      expect(result.success).toBe(false);
    });

    it('rejects weak password', () => {
      const result = adminCreateUserSchema.safeParse({ username: 'newuser', email: 'new@example.com', password: 'abc' });
      expect(result.success).toBe(false);
    });
  });

  describe('clientIdParamsSchema', () => {
    it('accepts a non-empty clientId string', () => {
      const result = clientIdParamsSchema.safeParse({ clientId: 'my-client' });
      expect(result.success).toBe(true);
    });

    it('rejects empty string', () => {
      const result = clientIdParamsSchema.safeParse({ clientId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing clientId', () => {
      const result = clientIdParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('createClientSchema', () => {
    it('accepts valid client data', () => {
      const result = createClientSchema.safeParse({
        client_name: 'My App',
        redirect_uris: 'https://myapp.com/callback',
      });
      expect(result.success).toBe(true);
    });

    it('accepts custom grant_types', () => {
      const result = createClientSchema.safeParse({
        client_name: 'My App',
        redirect_uris: 'https://myapp.com/callback',
        grant_types: 'authorization_code refresh_token',
      });
      expect(result.success).toBe(true);
    });

    it('uses authorization_code as default grant_types', () => {
      const result = createClientSchema.safeParse({
        client_name: 'My App',
        redirect_uris: 'https://myapp.com/callback',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.grant_types).toBe('authorization_code');
      }
    });

    it('rejects missing client_name', () => {
      const result = createClientSchema.safeParse({ redirect_uris: 'https://myapp.com/callback' });
      expect(result.success).toBe(false);
    });

    it('rejects missing redirect_uris', () => {
      const result = createClientSchema.safeParse({ client_name: 'My App' });
      expect(result.success).toBe(false);
    });

    it('rejects client_name longer than 100 chars', () => {
      const result = createClientSchema.safeParse({ client_name: 'A'.repeat(101), redirect_uris: 'https://a.com' });
      expect(result.success).toBe(false);
    });

    it('rejects empty redirect_uris', () => {
      const result = createClientSchema.safeParse({ client_name: 'My App', redirect_uris: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('updateClientSchema', () => {
    it('accepts empty object', () => {
      const result = updateClientSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts partial updates', () => {
      const result = updateClientSchema.safeParse({ client_name: 'Updated Name' });
      expect(result.success).toBe(true);
    });

    it('accepts is_active boolean', () => {
      const result = updateClientSchema.safeParse({ is_active: false });
      expect(result.success).toBe(true);
    });
  });

  describe('listUsersQuerySchema', () => {
    it('accepts minimal page and pageSize', () => {
      const result = listUsersQuerySchema.safeParse({ page: '1', pageSize: '20' });
      expect(result.success).toBe(true);
    });

    it('accepts with search filter', () => {
      const result = listUsersQuerySchema.safeParse({ page: '1', pageSize: '20', search: 'john' });
      expect(result.success).toBe(true);
    });

    it('accepts with tenant_id filter', () => {
      const result = listUsersQuerySchema.safeParse({ page: '1', pageSize: '20', tenant_id: 'default' });
      expect(result.success).toBe(true);
    });

    it('accepts is_active as string "1"', () => {
      const result = listUsersQuerySchema.safeParse({ page: '1', pageSize: '20', is_active: '1' });
      expect(result.success).toBe(true);
    });

    it('accepts is_active as string "true"', () => {
      const result = listUsersQuerySchema.safeParse({ page: '1', pageSize: '20', is_active: 'true' });
      expect(result.success).toBe(true);
    });

    it('transforms is_active "1" to 1', () => {
      const result = listUsersQuerySchema.safeParse({ page: '1', pageSize: '20', is_active: '1' });
      expect(result.success && result.data.is_active).toBe(1);
    });

    it('transforms is_active "true" to 1', () => {
      const result = listUsersQuerySchema.safeParse({ page: '1', pageSize: '20', is_active: 'true' });
      expect(result.success && result.data.is_active).toBe(1);
    });

    it('transforms is_active "0" to 0', () => {
      const result = listUsersQuerySchema.safeParse({ page: '1', pageSize: '20', is_active: '0' });
      expect(result.success && result.data.is_active).toBe(0);
    });
  });

  describe('tenantIdParamsSchema', () => {
    it('accepts a non-empty tenant ID', () => {
      const result = tenantIdParamsSchema.safeParse({ tenantId: 'default' });
      expect(result.success).toBe(true);
    });

    it('rejects empty string', () => {
      const result = tenantIdParamsSchema.safeParse({ tenantId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing tenantId', () => {
      const result = tenantIdParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('createTenantSchema', () => {
    it('accepts minimal valid input', () => {
      const result = createTenantSchema.safeParse({ name: 'New Tenant' });
      expect(result.success).toBe(true);
    });

    it('accepts domain', () => {
      const result = createTenantSchema.safeParse({ name: 'New Tenant', domain: 'tenant.example.com' });
      expect(result.success).toBe(true);
    });

    it('accepts settings', () => {
      const result = createTenantSchema.safeParse({ name: 'New Tenant', settings: { theme: 'dark' } });
      expect(result.success).toBe(true);
    });

    it('rejects missing name', () => {
      const result = createTenantSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects empty name', () => {
      const result = createTenantSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects name longer than 100 chars', () => {
      const result = createTenantSchema.safeParse({ name: 'A'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  describe('updateTenantSchema', () => {
    it('accepts empty object', () => {
      const result = updateTenantSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts partial updates', () => {
      const result = updateTenantSchema.safeParse({ name: 'Updated Name', is_active: false });
      expect(result.success).toBe(true);
    });

    it('accepts settings', () => {
      const result = updateTenantSchema.safeParse({ settings: { theme: 'light' } });
      expect(result.success).toBe(true);
    });
  });
});
