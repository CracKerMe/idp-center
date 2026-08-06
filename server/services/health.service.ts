import { sql } from 'drizzle-orm';
import { db } from '../database.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: ServiceHealth;
    smtp?: ServiceHealth;
  };
  checks?: Record<string, CheckResult>;
}

export interface ServiceHealth {
  status: 'ok' | 'error' | 'slow';
  latencyMs?: number;
  message?: string;
}

export interface CheckResult {
  status: 'pass' | 'fail' | 'warn';
  observedValue?: number | string;
  observedUnit?: string;
  message?: string;
}

const startTime = Date.now();

/**
 * Basic liveness check - just confirms the process is running.
 * Does NOT check dependencies (database, SMTP, etc.)
 */
export async function checkLiveness(): Promise<HealthCheckResult> {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: config.APP_VERSION || '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    services: {
      database: { status: 'ok' }, // Not actually checked for liveness
    },
  };
}

/**
 * Full readiness check - verifies all critical dependencies are available.
 * Used by load balancers to determine if the instance should receive traffic.
 */
export async function checkReadiness(): Promise<HealthCheckResult> {
  const checks: Record<string, CheckResult> = {};
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  // Database check
  const dbCheck = await checkDatabase();
  checks.database = {
    status: dbCheck.status === 'ok' ? 'pass' : dbCheck.status === 'slow' ? 'warn' : 'fail',
    observedValue: dbCheck.latencyMs,
    observedUnit: 'ms',
    message: dbCheck.message,
  };
  if (dbCheck.status === 'error') {
    overallStatus = 'unhealthy';
  }

  // SMTP check (optional - only if configured)
  let smtpCheck: ServiceHealth | undefined;
  if (config.SMTP_HOST) {
    const smtpResult = await checkSmtp();
    smtpCheck = smtpResult;
    checks.smtp = {
      status: smtpResult.status === 'ok' ? 'pass' : smtpResult.status === 'slow' ? 'warn' : 'fail',
      message: smtpResult.message,
    };
    if (smtpResult.status === 'error') {
      overallStatus = 'degraded'; // SMTP failure is degraded, not unhealthy
    }
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: config.APP_VERSION || '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    services: {
      database: dbCheck,
      ...(smtpCheck ? { smtp: smtpCheck } : {}),
    },
    checks,
  };
}

async function checkDatabase(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs > 100 ? 'slow' : 'ok',
      latencyMs,
      ...(latencyMs > 100 ? { message: 'Database response is slow' } : {}),
    };
  } catch (err) {
    logger.error('Health check: database connection failed', { error: err });
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      message: 'Database connection failed',
    };
  }
}

async function checkSmtp(): Promise<ServiceHealth> {
  // Simple TCP connection check to SMTP host
  // We don't actually send an email, just verify the server is reachable
  const net = await import('net');
  const port = config.SMTP_PORT || 587;
  const host = config.SMTP_HOST || 'localhost';

  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port, timeout: 5000 });

    socket.on('connect', () => {
      const latencyMs = Date.now() - start;
      socket.destroy();
      resolve({
        status: latencyMs > 1000 ? 'slow' : 'ok',
        latencyMs,
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        status: 'error',
        latencyMs: Date.now() - start,
        message: 'SMTP connection timeout',
      });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({
        status: 'error',
        latencyMs: Date.now() - start,
        message: `SMTP connection failed: ${err.message}`,
      });
    });
  });
}
