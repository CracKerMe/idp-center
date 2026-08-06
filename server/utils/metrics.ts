import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a custom registry
export const register = new Registry();

// Collect default metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register });

// ─── HTTP Metrics ───────────────────────────────────────────────────────────

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// ─── Auth/OIDC Metrics ──────────────────────────────────────────────────────

export const loginAttempts = new Counter({
  name: 'idp_login_attempts_total',
  help: 'Total login attempts',
  labelNames: ['outcome', 'method', 'tenant_id'], // outcome: success|fail|blocked
  registers: [register],
});

export const tokenIssued = new Counter({
  name: 'idp_tokens_issued_total',
  help: 'Total tokens issued by grant type',
  labelNames: ['grant_type', 'token_type', 'tenant_id'], // token_type: access|refresh|id
  registers: [register],
});

export const tokenIntrospect = new Counter({
  name: 'idp_token_introspect_total',
  help: 'Total token introspection requests',
  labelNames: ['active', 'tenant_id'],
  registers: [register],
});

export const mfaChallenge = new Counter({
  name: 'idp_mfa_challenges_total',
  help: 'Total MFA challenges issued',
  labelNames: ['type', 'tenant_id'], // type: totp|email|sms|webauthn|recovery
  registers: [register],
});

export const mfaVerify = new Counter({
  name: 'idp_mfa_verify_total',
  help: 'Total MFA verification attempts',
  labelNames: ['type', 'outcome', 'tenant_id'], // outcome: success|fail
  registers: [register],
});

// ─── Federation Metrics ─────────────────────────────────────────────────────

export const federationLogin = new Counter({
  name: 'idp_federation_login_total',
  help: 'Total federated login attempts',
  labelNames: ['provider_type', 'outcome', 'tenant_id'], // provider_type: saml|oidc|ldap|oauth2
  registers: [register],
});

// ─── SCIM Metrics ───────────────────────────────────────────────────────────

export const scimOperations = new Counter({
  name: 'idp_scim_operations_total',
  help: 'Total SCIM operations',
  labelNames: ['resource', 'method', 'status_code'],
  registers: [register],
});

// ─── Database Metrics ───────────────────────────────────────────────────────

export const dbQueryDuration = new Histogram({
  name: 'idp_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

export const dbConnectionPool = new Gauge({
  name: 'idp_db_connection_pool_size',
  help: 'Current database connection pool size',
  labelNames: ['state'], // state: active|idle|waiting
  registers: [register],
});

// ─── Key Management Metrics ─────────────────────────────────────────────────

export const signingKeyRotations = new Counter({
  name: 'idp_signing_key_rotations_total',
  help: 'Total signing key rotations',
  labelNames: ['outcome'], // outcome: success|failure
  registers: [register],
});

export const jwksRequests = new Counter({
  name: 'idp_jwks_requests_total',
  help: 'Total JWKS endpoint requests',
  registers: [register],
});

// ─── Back-channel Logout Metrics ────────────────────────────────────────────

export const backchannelLogoutDeliveries = new Counter({
  name: 'idp_backchannel_logout_deliveries_total',
  help: 'Total back-channel logout delivery attempts',
  labelNames: ['status'], // status: pending|delivered|failed
  registers: [register],
});

export const backchannelLogoutQueueSize = new Gauge({
  name: 'idp_backchannel_logout_queue_size',
  help: 'Current back-channel logout delivery queue size',
  registers: [register],
});

// ─── Cleanup/Maintenance Metrics ────────────────────────────────────────────

export const cleanupRuns = new Counter({
  name: 'idp_cleanup_runs_total',
  help: 'Total cleanup job runs',
  labelNames: ['job'], // job: tokens|keys|device_codes|audit_logs
  registers: [register],
});

export const cleanupItemsRemoved = new Counter({
  name: 'idp_cleanup_items_removed_total',
  help: 'Total items removed by cleanup jobs',
  labelNames: ['job'],
  registers: [register],
});

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Normalize route path for metrics (remove IDs and dynamic segments)
 */
export function normalizeRoute(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/[A-Za-z0-9_-]{20,}/g, '/:token')
    .replace(/\/device\/[A-Z]{4}-[A-Z]{4}/, '/device/:code')
    .replace(/\?.*$/, '');
}

/**
 * Get tenant ID from request (defaults to 'default')
 */
export function getTenantId(req: any): string {
  return req.tenantId || req.user?.tenant_id || 'default';
}
