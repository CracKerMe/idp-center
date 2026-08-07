import { pgTable, text, timestamp, boolean, integer, bigserial, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  // Monotonic insert-order counter — the hash chain and /audit/verify walk this instead of
  // created_at, since concurrent writers can share a millisecond-resolution timestamp but
  // never a seq value (logAudit() serializes inserts with pg_advisory_xact_lock precisely
  // so this stays a true total order).
  seq: bigserial('seq', { mode: 'number' }).notNull(),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  action: text('action').notNull(),
  targetId: text('target_id'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  details: text('details'),
  prevHash: text('prev_hash'),
  hash: text('hash'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_audit_logs_tenant_created').on(t.tenantId, t.createdAt),
  index('idx_audit_logs_user_created').on(t.userId, t.createdAt),
  index('idx_audit_logs_action').on(t.action),
  uniqueIndex('idx_audit_logs_seq').on(t.seq),
]);

export const passwordResets = pgTable('password_resets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const emailVerifications = pgTable('email_verifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  type: text('type').notNull(),
  newEmail: text('new_email'),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const accountDeletionRequests = pgTable('account_deletion_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique().references(() => users.id),
  requestedAt: timestamp('requested_at').defaultNow(),
  scheduledDeleteAt: timestamp('scheduled_delete_at').notNull(),
  cancelledAt: timestamp('cancelled_at'),
  completedAt: timestamp('completed_at'),
  status: text('status').default('pending'),
});

export const tenantPasswordPolicies = pgTable('tenant_password_policies', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().unique().references(() => tenants.id),
  minLength: integer('min_length').notNull().default(8),
  historyCount: integer('history_count').notNull().default(5),
  rotationEnabled: boolean('rotation_enabled').default(false),
  rotationPeriodDays: integer('rotation_period_days').notNull().default(90),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const passwordHistory = pgTable('password_history', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  tenantId: text('tenant_id').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_password_history_user').on(t.userId, t.createdAt),
]);

export const tenantIpWhitelist = pgTable('tenant_ip_whitelist', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  cidr: text('cidr').notNull(),
  description: text('description'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_ip_whitelist_tenant_cidr').on(t.tenantId, t.cidr),
  index('idx_ip_whitelist_tenant').on(t.tenantId),
]);
