import { pgTable, text, timestamp, integer, index } from 'drizzle-orm/pg-core';

// Only tables with live readers/writers live here. The AI-native plan also specifies
// event_store, alert_deliveries, adaptive_thresholds, runbook_executions and
// capacity_forecasts — those land alongside the services that use them (§2.1 event
// sourcing, §2.4 delivery tracking, §6.3–6.5), not ahead of them.

// ── Alerts ─────────────────────────────────────────────────────────────────

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  severity: text('severity').notNull().default('info'),   // info|low|medium|high|critical
  category: text('category').notNull(),                   // auth|risk|compliance|system
  title: text('title').notNull(),
  description: text('description').notNull(),
  sourceEventId: text('source_event_id'),
  userId: text('user_id'),
  status: text('status').notNull().default('open'),       // open|acknowledged|resolved|false_positive
  metadata: text('metadata'),                             // JSON
  createdAt: timestamp('created_at').defaultNow(),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: text('resolved_by'),
  resolutionNote: text('resolution_note'),
}, (t) => [
  index('idx_alerts_tenant_status').on(t.tenantId, t.status),
  index('idx_alerts_created').on(t.createdAt),
]);

// ── Health Check History ───────────────────────────────────────────────────

export const healthCheckHistory = pgTable('health_check_history', {
  id: text('id').primaryKey(),
  score: integer('score').notNull(),
  status: text('status').notNull(),                       // healthy|degraded|unhealthy
  checks: text('checks').notNull(),                       // JSON
  recommendations: text('recommendations'),               // JSON
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_health_history_time').on(t.createdAt),
]);

// ── Auto-Heal Log ──────────────────────────────────────────────────────────

export const autoHealLog = pgTable('auto_heal_log', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id').notNull(),
  ruleName: text('rule_name').notNull(),
  actionType: text('action_type').notNull(),
  actionParams: text('action_params'),                    // JSON
  status: text('status').notNull(),                       // success|failed|skipped|pending_confirmation
  error: text('error'),
  executedAt: timestamp('executed_at').defaultNow(),
  executedBy: text('executed_by').default('system'),
}, (t) => [
  index('idx_auto_heal_log_time').on(t.executedAt),
]);
