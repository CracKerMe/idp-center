import { pgTable, text, timestamp, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

// --- Phase 2.3: RBAC + SCIM ---

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_roles_tenant_name').on(t.tenantId, t.name),
]);

// Global dictionary — permission codes are not tenant-scoped, roles are.
export const permissions = pgTable('permissions', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),   // e.g. 'admin:*', 'admin:users:read', 'scim:write'
  description: text('description'),
});

export const rolePermissions = pgTable('role_permissions', {
  roleId: text('role_id').notNull().references(() => roles.id),
  permissionId: text('permission_id').notNull().references(() => permissions.id),
}, (t) => [
  uniqueIndex('idx_role_permissions_unique').on(t.roleId, t.permissionId),
]);

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_groups_tenant_name').on(t.tenantId, t.name),
]);

export const userRoles = pgTable('user_roles', {
  userId: text('user_id').notNull().references(() => users.id),
  roleId: text('role_id').notNull().references(() => roles.id),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
}, (t) => [
  uniqueIndex('idx_user_roles_unique').on(t.userId, t.roleId),
  index('idx_user_roles_user_tenant').on(t.userId, t.tenantId),
]);

export const userGroups = pgTable('user_groups', {
  userId: text('user_id').notNull().references(() => users.id),
  groupId: text('group_id').notNull().references(() => groups.id),
}, (t) => [
  uniqueIndex('idx_user_groups_unique').on(t.userId, t.groupId),
]);

export const groupRoles = pgTable('group_roles', {
  groupId: text('group_id').notNull().references(() => groups.id),
  roleId: text('role_id').notNull().references(() => roles.id),
}, (t) => [
  uniqueIndex('idx_group_roles_unique').on(t.groupId, t.roleId),
]);
