import { pgTable, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain'),
  isActive: boolean('is_active').default(true),
  settings: text('settings').default('{}'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const schemaMigrations = pgTable('schema_migrations', {
  version: integer('version').primaryKey(),
  name: text('name').notNull(),
  appliedAt: timestamp('applied_at').defaultNow(),
});
