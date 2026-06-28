import crypto from 'crypto';
import express from 'express';
import { db } from '../database.js';
import { logger } from './logger.js';
import { auditLogs } from '../schema.js';

export async function logAudit(
  userId: string | null,
  action: string,
  req: express.Request,
  details: string = '',
  tenantId: string = 'default'
) {
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  try {
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId,
      tenantId,
      action,
      ipAddress: ip,
      userAgent,
      details,
    });
  } catch (err) {
    logger.error('Failed to save audit log to database', { error: err, action, userId });
  }

  logger.info(`Audit: ${action}`, {
    action,
    userId,
    tenantId,
    ip,
    details
  });
}
