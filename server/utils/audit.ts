import crypto from 'crypto';
import express from 'express';
import { desc, sql } from 'drizzle-orm';
import { db } from '../database.js';
import { logger } from './logger.js';
import { auditLogs } from '../schema.js';
import type { AuditActionName } from './audit-actions.js';

// Arbitrary fixed key for pg_advisory_xact_lock — serializes concurrent logAudit() writers
// so the hash chain (prev_hash -> hash) stays a genuine total order instead of forking when
// two requests compute their prevHash from the same "latest" row at once.
const AUDIT_CHAIN_LOCK_ID = 8342091;

export interface LogAuditParams {
  req: express.Request;
  action: AuditActionName | (string & {});
  userId?: string | null;
  details?: string;
  targetId?: string;
  /** Overrides req.tenantId — for the rare case an admin action targets a different tenant than the caller's own (e.g. platform-admin creating a user in tenant B). */
  tenantId?: string;
}

export function computeAuditHash(row: {
  seq: number;
  tenantId: string;
  action: string;
  userId: string | null;
  details: string;
  createdAt: Date;
  prevHash: string | null;
}): string {
  const payload = JSON.stringify({
    seq: row.seq,
    tenantId: row.tenantId,
    action: row.action,
    userId: row.userId,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
    prevHash: row.prevHash,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export async function logAudit(params: LogAuditParams): Promise<void> {
  const { req, action, userId = null, details = '', targetId } = params;
  const tenantId = params.tenantId || req.tenantId || 'default';
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const id = crypto.randomUUID();
  const createdAt = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_ID})`);

      const [last] = await tx.select({ hash: auditLogs.hash, seq: auditLogs.seq }).from(auditLogs).orderBy(desc(auditLogs.seq)).limit(1);
      const prevHash = last?.hash ?? null;
      const seq = (last?.seq ?? 0) + 1;
      const hash = computeAuditHash({ seq, tenantId, action, userId, details, createdAt, prevHash });

      await tx.insert(auditLogs).values({
        id,
        userId,
        tenantId,
        action,
        targetId,
        ipAddress: ip,
        userAgent,
        details,
        createdAt,
        prevHash,
        hash,
      });
    });
  } catch (err) {
    logger.error('Failed to save audit log to database', { error: err, action, userId });
  }

  logger.info(`Audit: ${action}`, { action, userId, tenantId, ip, details });
}
