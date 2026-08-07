import { pgTable, text, timestamp, boolean, integer, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Phase 3: AI-native — risk engine feature store (login_events), behavior
// baselines (UEBA), and per-tenant scoring policies. See
// ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md §3.1.
// ---------------------------------------------------------------------------

export const loginEvents = pgTable('login_events', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  tenantId: text('tenant_id').notNull(),
  clientId: text('client_id'),
  outcome: text('outcome').notNull(),            // success | fail | blocked | challenged
  ip: text('ip'),
  asn: text('asn'),
  country: text('country'),
  city: text('city'),
  uaFamily: text('ua_family'),
  osFamily: text('os_family'),
  deviceFingerprint: text('device_fingerprint'),
  isNewDevice: boolean('is_new_device'),
  isNewCountry: boolean('is_new_country'),
  impossibleTravelKmh: integer('impossible_travel_kmh'),
  hourOfDay: integer('hour_of_day'),
  dayOfWeek: integer('day_of_week'),
  authMethods: text('auth_methods'),              // amr, comma-separated
  riskScore: integer('risk_score'),
  riskReasons: text('risk_reasons'),               // JSON-encoded RiskSignal[]
  riskAction: text('risk_action'),                 // allow | mfa_required | step_up | deny
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_login_events_user_time').on(t.userId, t.createdAt),
  index('idx_login_events_tenant_time').on(t.tenantId, t.createdAt),
]);

export const userBehaviorBaselines = pgTable('user_behavior_baselines', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  usualCountries: text('usual_countries'),         // JSON string[]
  usualAsns: text('usual_asns'),                   // JSON string[]
  usualHours: text('usual_hours'),                 // JSON number[] (0-23 buckets seen)
  usualDevices: text('usual_devices'),              // JSON string[] (device fingerprints)
  loginCount: integer('login_count').default(0),
  peerGroup: text('peer_group'),                    // group id from phase 2.3 RBAC groups
  featureVector: text('feature_vector'),            // JSON, reserved for the v2 ML model
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('idx_ubb_tenant').on(t.tenantId),
]);

export const riskPolicies = pgTable('risk_policies', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').default(true),
  minScore: integer('min_score').notNull(),
  maxScore: integer('max_score').notNull(),
  action: text('action').notNull(),                 // allow | mfa_required | step_up | deny | notify
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('idx_risk_policies_tenant').on(t.tenantId),
]);
