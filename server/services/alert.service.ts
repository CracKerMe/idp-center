import crypto from 'crypto';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../database.js';
import { alerts } from '../schema/events.js';
import { config } from '../config.js';
import { isEnabled } from './feature.service.js';
import { eventBus, type DomainEvent, type EventType } from './event-bus.service.js';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type AlertCategory = 'auth' | 'risk' | 'compliance' | 'system';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';

export interface Alert {
  id: string;
  tenantId: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  description: string;
  sourceEventId?: string;
  userId?: string;
  status: AlertStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNote?: string;
}

// ── SSE Subscribers ────────────────────────────────────────────────────────

type SSESubscriber = (alert: Alert) => void;
const sseSubscribers = new Map<string, { tenantId: string; userId: string; isPlatformAdmin: boolean; cb: SSESubscriber }>();
let subscriberCounter = 0;

// ── Alert Service ──────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(tenantId: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const key = tenantId;
  const timestamps = rateLimitMap.get(key) ?? [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= maxPerMinute) return false;
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}

export async function createAlert(params: {
  tenantId: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  description: string;
  sourceEventId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}): Promise<Alert | null> {
  // Rate limit per tenant
  if (!checkRateLimit(params.tenantId, config.ALERT_RATE_LIMIT_PER_MINUTE)) {
    logger.warn(`Alert rate limit exceeded for tenant ${params.tenantId}`);
    return null;
  }

  const id = crypto.randomUUID();
  const alert: Alert = {
    id,
    tenantId: params.tenantId,
    severity: params.severity,
    category: params.category,
    title: params.title,
    description: params.description,
    sourceEventId: params.sourceEventId,
    userId: params.userId,
    status: 'open',
    metadata: params.metadata ?? {},
    createdAt: new Date(),
  };

  // Persist
  await db.insert(alerts).values({
    id,
    tenantId: params.tenantId,
    severity: params.severity,
    category: params.category,
    title: params.title,
    description: params.description,
    sourceEventId: params.sourceEventId,
    userId: params.userId,
    status: 'open',
    metadata: JSON.stringify(params.metadata ?? {}),
  });

  // Push to SSE subscribers — strict tenant isolation
  // Only subscribers whose tenantId matches receive the alert.
  // isPlatformAdmin from DB (not JWT) allows cross-tenant visibility for platform admins.
  for (const [, sub] of sseSubscribers) {
    if (sub.tenantId === params.tenantId || sub.isPlatformAdmin) {
      try { sub.cb(alert); } catch (_e) { /* subscriber error, ignore */ }
    }
  }

  logger.info(`Alert created: [${params.severity}] ${params.title}`, {
    alertId: id,
    tenantId: params.tenantId,
  });

  return alert;
}

/** Subscribe to SSE alerts. Returns unsubscribe function. */
export function subscribeAlerts(
  tenantId: string,
  userId: string,
  isPlatformAdmin: boolean,
  cb: SSESubscriber,
): () => void {
  const key = `sub-${++subscriberCounter}`;
  sseSubscribers.set(key, { tenantId, userId, isPlatformAdmin, cb });
  return () => sseSubscribers.delete(key);
}

/** Acknowledge an alert */
export async function acknowledgeAlert(
  alertId: string,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  // userId is recorded for audit trail (who acknowledged)
  const result = await db.update(alerts)
    .set({ status: 'acknowledged', resolvedBy: userId })
    .where(and(eq(alerts.id, alertId), eq(alerts.tenantId, tenantId), eq(alerts.status, 'open')))
    .returning();
  return result.length > 0;
}

/** Resolve an alert */
export async function resolveAlert(
  alertId: string,
  tenantId: string,
  userId: string,
  note?: string,
): Promise<boolean> {
  const result = await db.update(alerts)
    .set({
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolutionNote: note,
    })
    .where(and(
      eq(alerts.id, alertId),
      eq(alerts.tenantId, tenantId),
      sql`${alerts.status} IN ('open', 'acknowledged')`,
    ))
    .returning();
  return result.length > 0;
}

/** List alerts for a tenant */
export async function listAlerts(
  tenantId: string,
  options?: {
    status?: AlertStatus;
    severity?: AlertSeverity;
    limit?: number;
    offset?: number;
  },
): Promise<Alert[]> {
  const conditions = [eq(alerts.tenantId, tenantId)];
  if (options?.status) conditions.push(eq(alerts.status, options.status));
  if (options?.severity) conditions.push(eq(alerts.severity, options.severity));

  const rows = await db.select().from(alerts)
    .where(and(...conditions))
    .orderBy(desc(alerts.createdAt))
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0);

  return rows.map(r => ({
    id: r.id,
    tenantId: r.tenantId,
    severity: r.severity as AlertSeverity,
    category: r.category as AlertCategory,
    title: r.title,
    description: r.description,
    sourceEventId: r.sourceEventId ?? undefined,
    userId: r.userId ?? undefined,
    status: r.status as AlertStatus,
    metadata: r.metadata ? JSON.parse(r.metadata) : {},
    createdAt: r.createdAt!,
    resolvedAt: r.resolvedAt ?? undefined,
    resolvedBy: r.resolvedBy ?? undefined,
    resolutionNote: r.resolutionNote ?? undefined,
  }));
}

// ── Alert Rules: Event → Alert mapping ─────────────────────────────────────

interface AlertRule {
  eventType: EventType;
  severity: AlertSeverity;
  category: AlertCategory;
  titleTemplate: string;
  descriptionTemplate: string;
}

const ALERT_RULES: AlertRule[] = [
  {
    eventType: 'auth.login.blocked',
    severity: 'medium',
    category: 'auth',
    titleTemplate: '登录被阻断',
    descriptionTemplate: '用户登录因风险评估被阻断',
  },
  {
    eventType: 'risk.alert.triggered',
    severity: 'high',
    category: 'risk',
    titleTemplate: '风险告警触发',
    descriptionTemplate: '风险引擎检测到异常行为',
  },
  {
    eventType: 'mfa.verify.fail',
    severity: 'low',
    category: 'auth',
    titleTemplate: 'MFA 验证失败',
    descriptionTemplate: '用户 MFA 验证失败',
  },
  // NOTE: session.risk.elevated rule removed — the event type exists in EventType but
  // no code emits it yet (session-level risk monitoring is not implemented). Add the rule
  // back when session risk monitoring lands.
  {
    eventType: 'system.health.degraded',
    severity: 'high',
    category: 'system',
    titleTemplate: '系统健康降级',
    descriptionTemplate: '系统健康检查检测到异常',
  },
];

/** Register event handlers that auto-generate alerts */
export function registerAlertRules(): void {
  for (const rule of ALERT_RULES) {
    eventBus.on(rule.eventType, async (event: DomainEvent) => {
      if (!isEnabled('alert')) return;

      // Extract severity/category from payload if overridden
      const severity = (event.payload.severity as AlertSeverity) ?? rule.severity;
      const category = (event.payload.category as AlertCategory) ?? rule.category;

      await createAlert({
        tenantId: event.tenantId,
        severity,
        category,
        title: (event.payload.title as string) ?? rule.titleTemplate,
        description: (event.payload.description as string) ?? rule.descriptionTemplate,
        sourceEventId: event.id,
        userId: event.userId,
        metadata: event.payload,
      });
    });
  }
}

/** Get alert counts by status for a tenant */
export async function getAlertCounts(tenantId: string): Promise<Record<AlertStatus, number>> {
  const rows = await db.select({
    status: alerts.status,
    count: sql<number>`count(*)::int`,
  })
    .from(alerts)
    .where(eq(alerts.tenantId, tenantId))
    .groupBy(alerts.status);

  const counts: Record<string, number> = { open: 0, acknowledged: 0, resolved: 0, false_positive: 0 };
  for (const row of rows) {
    counts[row.status] = row.count;
  }
  return counts as Record<AlertStatus, number>;
}
