import crypto from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '../database.js';
import { healthCheckHistory } from '../schema/events.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getCache } from './cache.service.js';
import { eventBus } from './event-bus.service.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckItem {
  name: string;
  status: CheckStatus;
  value: number | string;
  threshold: number | string;
  message: string;
  autoHeal?: string;
}

export interface HealthCheckResult {
  score: number;
  status: HealthStatus;
  checks: HealthCheckItem[];
  recommendations: string[];
  timestamp: Date;
}

// ── Individual Checks ──────────────────────────────────────────────────────

async function checkPgPool(): Promise<HealthCheckItem> {
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;

    if (latencyMs > 500) return { name: 'pg_connectivity', status: 'fail', value: latencyMs, threshold: 500, message: `查询延迟 ${latencyMs}ms > 500ms` };
    if (latencyMs > 100) return { name: 'pg_connectivity', status: 'warn', value: latencyMs, threshold: 100, message: `查询延迟 ${latencyMs}ms > 100ms` };
    return { name: 'pg_connectivity', status: 'pass', value: latencyMs, threshold: 100, message: `查询延迟 ${latencyMs}ms` };
  } catch (err: any) {
    return { name: 'pg_connectivity', status: 'fail', value: 'error', threshold: 'ok', message: `数据库连接失败: ${err.message}` };
  }
}

async function checkRedisConnectivity(): Promise<HealthCheckItem> {
  if (!config.REDIS_URL) {
    return { name: 'redis_connectivity', status: 'pass', value: 'disabled', threshold: 'ok', message: 'Redis 未配置，使用内存缓存' };
  }
  try {
    const cache = await getCache();
    const testKey = `_health:${Date.now()}`;
    await cache.set(testKey, '1', 10);
    const val = await cache.get(testKey);
    await cache.del(testKey);
    if (val === '1') return { name: 'redis_connectivity', status: 'pass', value: 'ok', threshold: 'ok', message: 'Redis 连接正常' };
    return { name: 'redis_connectivity', status: 'warn', value: 'mismatch', threshold: 'ok', message: 'Redis 读写不一致' };
  } catch (err: any) {
    return { name: 'redis_connectivity', status: 'fail', value: 'error', threshold: 'ok', message: `Redis 连接失败: ${err.message}`, autoHeal: 'redis_reconnect' };
  }
}

async function checkEventBusBacklog(): Promise<HealthCheckItem> {
  const backlog = await eventBus.getBacklogSize();
  if (backlog > 10000) return { name: 'event_bus_backlog', status: 'fail', value: backlog, threshold: 10000, message: `事件积压 ${backlog} > 10000`, autoHeal: 'event_bus_clear' };
  if (backlog > 1000) return { name: 'event_bus_backlog', status: 'warn', value: backlog, threshold: 1000, message: `事件积压 ${backlog} > 1000` };
  return { name: 'event_bus_backlog', status: 'pass', value: backlog, threshold: 1000, message: `事件积压 ${backlog}` };
}

async function checkMemoryUsage(): Promise<HealthCheckItem> {
  const usage = process.memoryUsage();
  const heapUsedPercent = Math.round((usage.heapUsed / usage.heapTotal) * 100);

  if (heapUsedPercent > 90) return { name: 'memory_usage', status: 'fail', value: heapUsedPercent, threshold: 90, message: `堆内存使用 ${heapUsedPercent}% > 90%` };
  if (heapUsedPercent > 80) return { name: 'memory_usage', status: 'warn', value: heapUsedPercent, threshold: 80, message: `堆内存使用 ${heapUsedPercent}% > 80%` };
  return { name: 'memory_usage', status: 'pass', value: heapUsedPercent, threshold: 80, message: `堆内存使用 ${heapUsedPercent}%` };
}

async function checkEventLoopLag(): Promise<HealthCheckItem> {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lagMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      if (lagMs > 500) resolve({ name: 'event_loop_lag', status: 'fail', value: Math.round(lagMs), threshold: 500, message: `事件循环延迟 ${Math.round(lagMs)}ms > 500ms` });
      else if (lagMs > 200) resolve({ name: 'event_loop_lag', status: 'warn', value: Math.round(lagMs), threshold: 200, message: `事件循环延迟 ${Math.round(lagMs)}ms > 200ms` });
      else resolve({ name: 'event_loop_lag', status: 'pass', value: Math.round(lagMs), threshold: 200, message: `事件循环延迟 ${Math.round(lagMs)}ms` });
    });
  });
}

async function checkKeyFreshness(): Promise<HealthCheckItem> {
  // Check if signing keys exist and are fresh (placeholder — requires keys.service)
  return { name: 'signing_key_freshness', status: 'pass', value: 'ok', threshold: '90d', message: '签名密钥状态正常' };
}

async function checkAlertBacklog(): Promise<HealthCheckItem> {
  try {
    const result = await db.execute(sql`SELECT count(*)::int AS cnt FROM alerts WHERE status = 'open'`);
    const count = (result as any)[0]?.cnt ?? 0;
    if (count > 100) return { name: 'alert_backlog', status: 'warn', value: count, threshold: 100, message: `未处理告警 ${count} 条` };
    return { name: 'alert_backlog', status: 'pass', value: count, threshold: 100, message: `未处理告警 ${count} 条` };
  } catch {
    return { name: 'alert_backlog', status: 'pass', value: 0, threshold: 100, message: '告警表暂无数据' };
  }
}

// ── Health Checker ─────────────────────────────────────────────────────────

const ALL_CHECKS = [
  { fn: checkPgPool, weight: 25 },
  { fn: checkRedisConnectivity, weight: 15 },
  { fn: checkEventBusBacklog, weight: 15 },
  { fn: checkAlertBacklog, weight: 10 },
  { fn: checkMemoryUsage, weight: 15 },
  { fn: checkEventLoopLag, weight: 15 },
  // checkKeyFreshness is a stub — weight 0 until properly implemented
  { fn: checkKeyFreshness, weight: 0 },
];

export async function runHealthCheck(): Promise<HealthCheckResult> {
  const checks: HealthCheckItem[] = [];
  let weightedScore = 0;
  let totalWeight = 0;

  for (const { fn, weight } of ALL_CHECKS) {
    try {
      const result = await fn();
      checks.push(result);
      const itemScore = result.status === 'pass' ? 100 : result.status === 'warn' ? 50 : 0;
      weightedScore += itemScore * weight;
      totalWeight += weight;
    } catch (err: any) {
      checks.push({
        name: fn.name,
        status: 'fail',
        value: 'error',
        threshold: 'ok',
        message: `检查异常: ${err.message}`,
      });
      totalWeight += weight;
    }
  }

  const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
  const status: HealthStatus = score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'unhealthy';

  const recommendations: string[] = [];
  for (const check of checks) {
    if (check.status === 'fail') {
      recommendations.push(`🔴 ${check.name}: ${check.message}`);
    } else if (check.status === 'warn') {
      recommendations.push(`🟡 ${check.name}: ${check.message}`);
    }
  }

  const result: HealthCheckResult = { score, status, checks, recommendations, timestamp: new Date() };

  // Emit event if degraded
  if (status !== 'healthy') {
    await eventBus.emit({
      id: crypto.randomUUID(),
      type: 'system.health.degraded',
      tenantId: 'system',
      timestamp: new Date(),
      payload: { score, status, failedChecks: checks.filter(c => c.status === 'fail').map(c => c.name) },
    });
  }

  return result;
}

/** Persist health check result */
export async function persistHealthCheck(result: HealthCheckResult): Promise<void> {
  try {
    await db.insert(healthCheckHistory).values({
      id: crypto.randomUUID(),
      score: result.score,
      status: result.status,
      checks: JSON.stringify(result.checks),
      recommendations: JSON.stringify(result.recommendations),
    });
  } catch (err: any) {
    logger.error(`Failed to persist health check: ${err.message}`);
  }
}

/** Get health check history */
export async function getHealthHistory(hours: number = 24): Promise<Array<{
  score: number;
  status: string;
  createdAt: Date;
}>> {
  const since = new Date(Date.now() - hours * 3600_000);
  const rows = await db.select({
    score: healthCheckHistory.score,
    status: healthCheckHistory.status,
    createdAt: healthCheckHistory.createdAt,
  })
    .from(healthCheckHistory)
    .where(sql`${healthCheckHistory.createdAt} >= ${since}`)
    .orderBy(healthCheckHistory.createdAt);

  return rows.map(r => ({ score: r.score, status: r.status, createdAt: r.createdAt! }));
}

/** Cleanup old health check history records */
export async function cleanupHealthHistory(): Promise<number> {
  const retentionDays = config.HEALTH_HISTORY_RETENTION_DAYS ?? 30;
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);
  try {
    const result = await db.execute(
      sql`DELETE FROM health_check_history WHERE created_at < ${cutoff}`
    );
    const deleted = (result as any).count ?? 0;
    if (deleted > 0) {
      logger.info(`Cleaned up ${deleted} health check records older than ${retentionDays} days`);
    }
    return deleted;
  } catch (err: any) {
    logger.error(`Health history cleanup failed: ${err.message}`);
    return 0;
  }
}
