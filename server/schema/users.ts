import { pgTable, text, timestamp, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  tenantId: text('tenant_id').default('default'),
  isActive: boolean('is_active').default(true),
  isAdmin: boolean('is_admin').default(false),
  isPlatformAdmin: boolean('is_platform_admin').default(false),
  otpSecret: text('otp_secret'),
  otpEnabled: boolean('otp_enabled').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  phone: text('phone'),
  passwordChangedAt: timestamp('password_changed_at').defaultNow(),
  failedLoginAttempts: integer('failed_login_attempts').default(0),
  lockedUntil: timestamp('locked_until'),
  emailVerified: boolean('email_verified').default(false),
  emailVerifiedAt: timestamp('email_verified_at'),
  mustChangePassword: boolean('must_change_password').default(false),
}, (t) => [
  uniqueIndex('idx_users_username_tenant').on(t.username, t.tenantId),
  uniqueIndex('idx_users_email_tenant').on(t.email, t.tenantId),
  index('idx_users_tenant').on(t.tenantId),
]);
