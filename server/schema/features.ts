import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// System-level (global) feature toggle overrides. No row for a key => resolve() falls back
// to the env-derived default (server/features/registry.ts). Deliberately NOT tenant-scoped.
// `value` is JSON-encoded so one column serves both boolean and tri-state flags.
export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),          // JSON: 'true' | 'false' | '"shadow"'
  updatedBy: text('updated_by'),           // admin user id; null for system/seed writes
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
