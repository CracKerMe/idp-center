import { pgTable, text, timestamp, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain'),
  isActive: boolean('is_active').default(true),
  settings: text('settings').default('{}'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  tenantId: text('tenant_id').default('default'),
  isActive: boolean('is_active').default(true),
  isAdmin: boolean('is_admin').default(false),
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

export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret').notNull(),
  clientName: text('client_name').notNull(),
  redirectUris: text('redirect_uris').notNull(),
  grantTypes: text('grant_types').notNull(),
  tenantId: text('tenant_id').default('default').references(() => tenants.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const authCodes = pgTable('auth_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  clientId: text('client_id').notNull(),
  userId: text('user_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  nonce: text('nonce'),
  scope: text('scope').default('openid'),
  codeChallenge: text('code_challenge'),
  codeChallengeMethod: text('code_challenge_method').default('S256'),
});

export const accessTokens = pgTable('access_tokens', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  clientId: text('client_id').notNull(),
  userId: text('user_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revoked: boolean('revoked').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  scope: text('scope').default('openid'),
  revokedAt: timestamp('revoked_at'),
  revokeReason: text('revoke_reason'),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id),
  clientId: text('client_id'),
  expiresAt: timestamp('expires_at').notNull(),
  revoked: boolean('revoked').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  rememberMe: boolean('remember_me').default(false),
  deviceId: text('device_id'),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  deviceInfo: text('device_info'),
  ipAddress: text('ip_address'),
  lastActive: timestamp('last_active').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  action: text('action').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  details: text('details'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const passwordResets = pgTable('password_resets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
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

export const linkedAccounts = pgTable('linked_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  providerUsername: text('provider_username'),
  accessToken: text('access_token'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_linked_accounts_provider_user').on(t.provider, t.providerUserId),
]);

export const trustedDevices = pgTable('trusted_devices', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  deviceFingerprint: text('device_fingerprint').notNull(),
  deviceName: text('device_name'),
  trustedAt: timestamp('trusted_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  lastUsedAt: timestamp('last_used_at'),
}, (t) => [
  uniqueIndex('idx_trusted_devices_user_fingerprint').on(t.userId, t.deviceFingerprint),
]);

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

export const schemaMigrations = pgTable('schema_migrations', {
  version: integer('version').primaryKey(),
  name: text('name').notNull(),
  appliedAt: timestamp('applied_at').defaultNow(),
});

export const signingKeys = pgTable('signing_keys', {
  id: text('id').primaryKey(),
  kid: text('kid').notNull().unique(),
  alg: text('alg').notNull().default('RS256'),
  use: text('use').notNull().default('sig'),
  publicJwk: text('public_jwk').notNull(),
  privateJwkEnc: text('private_jwk_enc').notNull(),
  status: text('status').notNull().default('next'), // active | next | retired
  createdAt: timestamp('created_at').defaultNow(),
  activatedAt: timestamp('activated_at'),
  retiredAt: timestamp('retired_at'),
  expiresAt: timestamp('expires_at'),
}, (t) => [
  index('idx_signing_keys_status').on(t.status),
]);
