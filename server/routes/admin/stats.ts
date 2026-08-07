import express from 'express';
import { db } from '../../database.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction, PRIVILEGED_ACTIONS, ANOMALY_ACTIONS } from '../../utils/audit-actions.js';
import { authenticateAdmin, authenticatePlatformAdmin } from '../../middleware/auth.js';
import { success } from '../../utils/response.js';
import { users, clients, tenants, auditLogs, sessions, accessTokens, mfaFactors, accountDeletionRequests } from '../../schema.js';
import { eq, and, gt, gte, ne, inArray, count, countDistinct } from 'drizzle-orm';

const router = express.Router();

// GET /api/admin/stats — tenant-scoped counts. Tenant-admins never see other tenants'
// numbers; platform-admins get the same shape but summed across every tenant via
// /api/admin/stats/platform below.
router.get('/stats', authenticateAdmin, async (req, res) => {
  const tenantId = req.tenantId;
  const userWhere = req.isPlatformAdmin ? undefined : eq(users.tenantId, tenantId);
  const clientWhere = req.isPlatformAdmin ? undefined : eq(clients.tenantId, tenantId);

  const [{ count: userCount }] = await db.select({ count: count() }).from(users).where(userWhere);
  const [{ count: clientCount }] = await db.select({ count: count() }).from(clients).where(clientWhere);

  const [{ count: activeTokens }] = await db
    .select({ count: count() })
    .from(accessTokens)
    .where(req.isPlatformAdmin
      ? and(eq(accessTokens.revoked, false), gt(accessTokens.expiresAt, new Date()))
      : and(eq(accessTokens.revoked, false), gt(accessTokens.expiresAt, new Date()), eq(accessTokens.tenantId, tenantId)));

  // sessions has no tenant_id column — scope via its user's tenant.
  const [{ count: activeSessions }] = await db
    .select({ count: count() })
    .from(sessions)
    .where(req.isPlatformAdmin ? undefined : inArray(sessions.userId, db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId))));

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const auditTenantCond = req.isPlatformAdmin ? undefined : eq(auditLogs.tenantId, tenantId);

  const [{ count: recentLogins }] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, 'LOGIN_SUCCESS'), gt(auditLogs.createdAt, yesterday), ...(auditTenantCond ? [auditTenantCond] : [])));

  const [{ count: recentRegistrations }] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, 'REGISTER'), gt(auditLogs.createdAt, yesterday), ...(auditTenantCond ? [auditTenantCond] : [])));

  res.json(success({
    users: Number(userCount),
    clients: Number(clientCount),
    activeTokens: Number(activeTokens),
    activeSessions: Number(activeSessions),
    last24h: { logins: Number(recentLogins), registrations: Number(recentRegistrations) },
  }));
});

// GET /api/admin/stats/platform — cross-tenant totals, platform-admin only.
router.get('/stats/platform', authenticatePlatformAdmin, async (req, res) => {
  const [{ count: userCount }] = await db.select({ count: count() }).from(users);
  const [{ count: tenantCount }] = await db.select({ count: count() }).from(tenants);
  const [{ count: clientCount }] = await db.select({ count: count() }).from(clients);
  const [{ count: activeTokens }] = await db
    .select({ count: count() })
    .from(accessTokens)
    .where(and(eq(accessTokens.revoked, false), gt(accessTokens.expiresAt, new Date())));
  const [{ count: activeSessions }] = await db.select({ count: count() }).from(sessions);

  res.json(success({
    users: Number(userCount),
    tenants: Number(tenantCount),
    clients: Number(clientCount),
    activeTokens: Number(activeTokens),
    activeSessions: Number(activeSessions),
  }));
});

// GET /api/admin/compliance/report?standard=soc2|gdpr&days=30
// Aggregates the signals a SOC2/GDPR auditor actually asks for: login success rate, MFA
// coverage, privileged-action volume, and anomaly counts, all tenant-scoped. GDPR adds the
// data-subject-request backlog from account_deletion_requests.
router.get('/compliance/report', authenticateAdmin, async (req, res) => {
  const standard = req.query.standard === 'gdpr' ? 'gdpr' : 'soc2';
  const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const tenantId = req.tenantId;
  const tenantCond = eq(auditLogs.tenantId, tenantId);
  const windowCond = and(tenantCond, gte(auditLogs.createdAt, since));

  const [{ count: loginSuccessCount }] = await db.select({ count: count() }).from(auditLogs).where(and(windowCond, eq(auditLogs.action, AuditAction.LOGIN_SUCCESS)));
  const [{ count: loginFailedCount }] = await db.select({ count: count() }).from(auditLogs).where(and(windowCond, eq(auditLogs.action, AuditAction.LOGIN_FAILED)));
  const totalLoginAttempts = Number(loginSuccessCount) + Number(loginFailedCount);
  const loginSuccessRate = totalLoginAttempts > 0 ? Number(loginSuccessCount) / totalLoginAttempts : null;

  const [{ count: activeUserCount }] = await db.select({ count: count() }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
  const [{ count: mfaEnabledUserCount }] = await db
    .select({ count: countDistinct(mfaFactors.userId) })
    .from(mfaFactors)
    .innerJoin(users, eq(mfaFactors.userId, users.id))
    .where(and(eq(users.tenantId, tenantId), eq(mfaFactors.status, 'active'), ne(mfaFactors.type, 'recovery')));
  const mfaCoverage = Number(activeUserCount) > 0 ? Number(mfaEnabledUserCount) / Number(activeUserCount) : null;

  const privilegedRows = await db.select({ action: auditLogs.action, count: count() })
    .from(auditLogs)
    .where(and(windowCond, inArray(auditLogs.action, PRIVILEGED_ACTIONS as unknown as string[])))
    .groupBy(auditLogs.action);

  const anomalyRows = await db.select({ action: auditLogs.action, count: count() })
    .from(auditLogs)
    .where(and(windowCond, inArray(auditLogs.action, ANOMALY_ACTIONS as unknown as string[])))
    .groupBy(auditLogs.action);

  const report: Record<string, unknown> = {
    standard,
    tenantId,
    windowDays: days,
    generatedAt: new Date().toISOString(),
    loginSuccessRate,
    loginAttempts: totalLoginAttempts,
    mfaCoverage,
    activeUsers: Number(activeUserCount),
    mfaEnabledUsers: Number(mfaEnabledUserCount),
    privilegedActions: { total: privilegedRows.reduce((s, r) => s + Number(r.count), 0), byAction: Object.fromEntries(privilegedRows.map(r => [r.action, Number(r.count)])) },
    anomalyEvents: { total: anomalyRows.reduce((s, r) => s + Number(r.count), 0), byAction: Object.fromEntries(anomalyRows.map(r => [r.action, Number(r.count)])) },
  };

  if (standard === 'gdpr') {
    const [{ count: pendingDeletions }] = await db.select({ count: count() }).from(accountDeletionRequests).where(eq(accountDeletionRequests.status, 'pending'));
    const [{ count: completedDeletions }] = await db.select({ count: count() }).from(accountDeletionRequests).where(and(eq(accountDeletionRequests.status, 'completed'), gte(accountDeletionRequests.completedAt, since)));
    report.dataSubjectRequests = { pendingDeletions: Number(pendingDeletions), completedDeletionsInWindow: Number(completedDeletions) };
    report.selfServiceDataExportAvailable = true;
  }

  await logAudit({ req, action: AuditAction.COMPLIANCE_REPORT_GENERATED, userId: req.user!.id, details: `standard=${standard} days=${days}` });
  res.json(success(report));
});

export default router;
