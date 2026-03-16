import crypto from 'crypto';
import express from 'express';
import { db } from '../database.js';

export function logAudit(
  userId: string | null,
  action: string,
  req: express.Request,
  details: string = '',
  tenantId: string = 'default'
) {
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  db.prepare(
    'INSERT INTO audit_logs (id, user_id, tenant_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, tenantId, action, ip, userAgent, details);

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${action} | User: ${userId || 'anonymous'} | IP: ${ip} | ${details}`);
}
