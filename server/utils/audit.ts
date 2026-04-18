import crypto from 'crypto';
import express from 'express';
import { db } from '../database.js';
import { logger } from './logger.js';

export function logAudit(
  userId: string | null,
  action: string,
  req: express.Request,
  details: string = '',
  tenantId: string = 'default'
) {
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  try {
    db.prepare(
      'INSERT INTO audit_logs (id, user_id, tenant_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), userId, tenantId, action, ip, userAgent, details);
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
