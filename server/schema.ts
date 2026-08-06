import { pgTable, text, timestamp, boolean, integer, bigserial, index, uniqueIndex } from 'drizzle-orm/pg-core';

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

export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret').notNull(),
  clientSecretHash: text('client_secret_hash'),
  clientSecretAlg: text('client_secret_alg'),
  clientName: text('client_name').notNull(),
  redirectUris: text('redirect_uris').notNull(),
  grantTypes: text('grant_types').notNull(),
  tenantId: text('tenant_id').default('default').references(() => tenants.id),
  isResourceServer: boolean('is_resource_server').default(false),
  allowedScopes: text('allowed_scopes'),
  frontchannelLogoutUri: text('frontchannel_logout_uri'),
  backchannelLogoutUri: text('backchannel_logout_uri'),
  postLogoutRedirectUris: text('post_logout_redirect_uris'),
  jwks: text('jwks'),
  jwksUri: text('jwks_uri'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').default('client_secret_post'),
  allowedAudiences: text('allowed_audiences'),
  registrationTokenHash: text('registration_token_hash'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_clients_tenant').on(t.tenantId),
]);

export const authCodes = pgTable('auth_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  clientId: text('client_id').notNull(),
  userId: text('user_id').notNull(),
  tenantId: text('tenant_id').notNull().default('default'),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  nonce: text('nonce'),
  scope: text('scope').default('openid'),
  codeChallenge: text('code_challenge'),
  codeChallengeMethod: text('code_challenge_method').default('S256'),
  sid: text('sid'),
});

export const accessTokens = pgTable('access_tokens', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  tokenHash: text('token_hash'),
  clientId: text('client_id').notNull(),
  userId: text('user_id').notNull(),
  tenantId: text('tenant_id').notNull().default('default'),
  subjectType: text('subject_type').notNull().default('user'), // 'user' | 'client'
  oidcSessionId: text('oidc_session_id'),
  authCodeId: text('auth_code_id'),
  expiresAt: timestamp('expires_at').notNull(),
  revoked: boolean('revoked').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  scope: text('scope').default('openid'),
  revokedAt: timestamp('revoked_at'),
  revokeReason: text('revoke_reason'),
}, (t) => [
  index('idx_access_tokens_hash').on(t.tokenHash),
  index('idx_access_tokens_session').on(t.oidcSessionId),
  index('idx_access_tokens_auth_code').on(t.authCodeId),
  index('idx_access_tokens_user').on(t.userId),
]);

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id),
  clientId: text('client_id'),
  tenantId: text('tenant_id').notNull().default('default'),
  scope: text('scope').default('openid'),
  familyId: text('family_id'),
  oidcSessionId: text('oidc_session_id'),
  authCodeId: text('auth_code_id'),
  sessionId: text('session_id'),
  expiresAt: timestamp('expires_at').notNull(),
  revoked: boolean('revoked').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  rememberMe: boolean('remember_me').default(false),
  deviceId: text('device_id'),
}, (t) => [
  index('idx_refresh_tokens_family').on(t.familyId),
  index('idx_refresh_tokens_session').on(t.oidcSessionId),
  index('idx_refresh_tokens_auth_code').on(t.authCodeId),
]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  deviceInfo: text('device_info'),
  ipAddress: text('ip_address'),
  amr: text('amr'),  // comma-separated auth methods used, e.g. "pwd,otp"
  acr: text('acr'),  // authentication context class reference, "0" | "1"
  lastActive: timestamp('last_active').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

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

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  // Federation-only (OIDC RP flow): which identity_providers row this state belongs to,
  // plus a JSON blob of { nonce, codeVerifier, redirectAfter } — kept as one column instead
  // of three narrow ones since only the federation flow ever populates it.
  provider: text('provider'),
  payload: text('payload'),
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
  // Nullable for the transition window — backfilled from the linked user's tenant by
  // identity-link.service.ts's migrateLegacyLinkedAccounts() on startup. Needed because two
  // different tenants' SAML/OIDC IdPs can otherwise mint colliding providerUserId values
  // (unlike GitHub's globally-unique numeric id, a NameID like "user123" is only unique
  // within its own IdP) — without this, linking one would silently hijack the other.
  tenantId: text('tenant_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_linked_accounts_provider_user_tenant').on(t.provider, t.providerUserId, t.tenantId),
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

export const deviceCodes = pgTable('device_codes', {
  id: text('id').primaryKey(),
  deviceCode: text('device_code').notNull().unique(),
  userCode: text('user_code').notNull(),
  clientId: text('client_id').notNull(),
  tenantId: text('tenant_id').notNull().default('default'),
  scope: text('scope').default('openid'),
  status: text('status').notNull().default('pending'), // pending | approved | denied | redeemed | expired
  userId: text('user_id'),
  nonce: text('nonce'),
  interval: integer('interval').notNull().default(5),
  lastPolledAt: timestamp('last_polled_at'),
  pollCount: integer('poll_count').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_device_codes_usercode_tenant').on(t.userCode, t.tenantId),
  index('idx_device_codes_expires').on(t.expiresAt),
]);

export const oidcSessions = pgTable('oidc_sessions', {
  id: text('id').primaryKey(),
  sid: text('sid').notNull(),
  browserSessionId: text('browser_session_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  clientId: text('client_id').notNull(),
  tenantId: text('tenant_id').notNull().default('default'),
  scope: text('scope'),
  amr: text('amr'),  // comma-separated auth methods used, e.g. "pwd,otp"
  acr: text('acr'),  // authentication context class reference, "0" | "1"
  authTime: timestamp('auth_time').notNull().defaultNow(),
  lastRefreshedAt: timestamp('last_refreshed_at').defaultNow(),
  terminatedAt: timestamp('terminated_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_oidc_sessions_sid_tenant').on(t.sid, t.tenantId),
  index('idx_oidc_sessions_browser').on(t.browserSessionId),
  index('idx_oidc_sessions_user_client').on(t.userId, t.clientId),
]);

export const backchannelLogoutDeliveries = pgTable('backchannel_logout_deliveries', {
  id: text('id').primaryKey(),
  oidcSessionId: text('oidc_session_id').notNull(),
  clientId: text('client_id').notNull(),
  url: text('url').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
  status: text('status').notNull().default('pending'), // pending | delivered | failed
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_backchannel_deliveries_status').on(t.status, t.nextAttemptAt),
]);

export const clientAssertionJtis = pgTable('client_assertion_jtis', {
  jti: text('jti').primaryKey(),
  clientId: text('client_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const pushedAuthRequests = pgTable('pushed_auth_requests', {
  requestUri: text('request_uri').primaryKey(),
  clientId: text('client_id').notNull(),
  tenantId: text('tenant_id').notNull().default('default'),
  payload: text('payload').notNull(), // JSON-encoded authorize params
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_par_expires').on(t.expiresAt),
]);

export const dpopJtis = pgTable('dpop_jtis', {
  jti: text('jti').primaryKey(),
  jkt: text('jkt').notNull(), // base64url SHA-256 thumbprint of the DPoP public key
  expiresAt: timestamp('expires_at').notNull(),
});

// --- Phase 2.1: MFA ---

export const mfaFactors = pgTable('mfa_factors', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),          // totp | sms | email | webauthn | recovery
  name: text('name'),
  secretEnc: text('secret_enc'),         // TOTP secret (encryptToken) or recovery code bcrypt hash
  phone: text('phone'),
  email: text('email'),
  credentialId: text('credential_id'),   // WebAuthn credential id (base64url)
  publicKey: text('public_key'),         // WebAuthn public key (base64url)
  counter: integer('counter').default(0),
  transports: text('transports'),
  status: text('status').notNull().default('pending'),  // pending | active | disabled | used
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_mfa_factors_user').on(t.userId, t.type),
]);

export const mfaChallenges = pgTable('mfa_challenges', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  factorId: text('factor_id'),
  type: text('type').notNull(),          // totp | sms | email | webauthn | recovery
  codeHash: text('code_hash'),           // sha256(code) for sms/email OTP
  challenge: text('challenge'),          // WebAuthn challenge (base64url) or setup nonce
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_mfa_challenges_user').on(t.userId),
]);

export const tenantMfaPolicies = pgTable('tenant_mfa_policies', {
  tenantId: text('tenant_id').primaryKey().references(() => tenants.id),
  required: boolean('required').default(false),
  requiredForAdmins: boolean('required_for_admins').default(true),
  allowedTypes: text('allowed_types').default('totp,webauthn,email'),
  rememberDeviceDays: integer('remember_device_days').default(30),
  updatedAt: timestamp('updated_at').defaultNow(),
});

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

// --- Phase 2.2: Federated identity ---

export const identityProviders = pgTable('identity_providers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  alias: text('alias').notNull(),               // URL segment: /api/federation/:alias/...
  type: text('type').notNull(),                  // saml | oidc | ldap | oauth2
  displayName: text('display_name').notNull(),
  enabled: boolean('enabled').default(true),
  configEnc: text('config_enc').notNull(),        // full config JSON, encryptToken()
  attributeMapping: text('attribute_mapping').notNull().default('{}'),
  jitProvisioning: boolean('jit_provisioning').default(true),
  linkByVerifiedEmail: boolean('link_by_verified_email').default(false),
  defaultRoles: text('default_roles'),
  emailDomains: text('email_domains'),            // comma-separated, for login-page auto-routing
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_idp_tenant_alias').on(t.tenantId, t.alias),
]);

// SAML assertions are single-use (RFC-adjacent convention, not a hard SAML requirement,
// but the standard replay defense): each assertion ID is recorded once and rejected on reuse.
export const samlAssertionIds = pgTable('saml_assertion_ids', {
  assertionId: text('assertion_id').primaryKey(),
  idpAlias: text('idp_alias').notNull(),
  tenantId: text('tenant_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_saml_assertion_expires').on(t.expiresAt),
]);
