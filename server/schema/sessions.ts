import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.js';

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
