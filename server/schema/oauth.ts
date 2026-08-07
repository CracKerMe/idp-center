import { pgTable, text, timestamp, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

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
  riskScore: integer('risk_score'),          // re-assessed on each refresh; a jump revokes the session (UEBA, phase 3.2)
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
