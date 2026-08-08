import express from 'express';
import crypto from 'crypto';
import { db } from '../../database.js';
import { getValue } from '../../services/feature.service.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { authenticateAdmin, authenticatePlatformAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, message, paginated, ErrorCode } from '../../utils/response.js';
import { riskPolicies, loginEvents } from '../../schema.js';
import { eq, and, gte, desc, asc, count, sql } from 'drizzle-orm';
import { createRiskPolicySchema, updateRiskPolicySchema, riskPolicyIdParamsSchema, listLoginEventsQuerySchema } from '../../validators/admin.validator.js';
import { runUebaBaselineJob } from '../../jobs/ueba.job.js';

const router = express.Router();

// GET /api/admin/risk/policies
router.get('/risk/policies', authenticateAdmin, async (req, res) => {
  const rows = await db.select().from(riskPolicies).where(eq(riskPolicies.tenantId, req.tenantId)).orderBy(asc(riskPolicies.minScore));
  res.json(success(rows));
});

// POST /api/admin/risk/policies
router.post('/risk/policies', authenticateAdmin, validate({ body: createRiskPolicySchema }), async (req, res) => {
  const { name, enabled, minScore, maxScore, action } = req.body;
  const id = crypto.randomUUID();
  await db.insert(riskPolicies).values({ id, tenantId: req.tenantId, name, enabled: enabled ?? true, minScore, maxScore, action });
  await logAudit({ req, action: AuditAction.RISK_POLICY_CREATED, userId: req.user!.id, details: JSON.stringify({ id, name, minScore, maxScore, action }), tenantId: req.tenantId });
  res.status(201).json(success({ id }, 'Risk policy created'));
});

// PUT /api/admin/risk/policies/:id
router.put('/risk/policies/:id', authenticateAdmin, validate({ params: riskPolicyIdParamsSchema, body: updateRiskPolicySchema }), async (req, res) => {
  const [existing] = await db.select({ id: riskPolicies.id }).from(riskPolicies).where(and(eq(riskPolicies.id, req.params.id), eq(riskPolicies.tenantId, req.tenantId))).limit(1);
  if (!existing) return res.status(404).json(error('Risk policy not found', ErrorCode.RESOURCE_NOT_FOUND));

  const { name, enabled, minScore, maxScore, action } = req.body;
  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (name !== undefined) updateData.name = name;
  if (enabled !== undefined) updateData.enabled = enabled;
  if (minScore !== undefined) updateData.minScore = minScore;
  if (maxScore !== undefined) updateData.maxScore = maxScore;
  if (action !== undefined) updateData.action = action;

  await db.update(riskPolicies).set(updateData).where(eq(riskPolicies.id, req.params.id));
  await logAudit({ req, action: AuditAction.RISK_POLICY_UPDATED, userId: req.user!.id, details: JSON.stringify({ id: req.params.id, ...updateData }), tenantId: req.tenantId });
  res.json(message('Risk policy updated'));
});

// DELETE /api/admin/risk/policies/:id
router.delete('/risk/policies/:id', authenticateAdmin, validate({ params: riskPolicyIdParamsSchema }), async (req, res) => {
  const [existing] = await db.select({ id: riskPolicies.id }).from(riskPolicies).where(and(eq(riskPolicies.id, req.params.id), eq(riskPolicies.tenantId, req.tenantId))).limit(1);
  if (!existing) return res.status(404).json(error('Risk policy not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.delete(riskPolicies).where(eq(riskPolicies.id, req.params.id));
  await logAudit({ req, action: AuditAction.RISK_POLICY_DELETED, userId: req.user!.id, details: JSON.stringify({ id: req.params.id }), tenantId: req.tenantId });
  res.json(message('Risk policy deleted'));
});

// GET /api/admin/risk/events — recent login_events for this tenant, most recent first.
router.get('/risk/events', authenticateAdmin, validate({ query: listLoginEventsQuerySchema }), async (req, res) => {
  const { userId, outcome, minScore, limit, offset } = req.query as any;
  const conditions = [eq(loginEvents.tenantId, req.tenantId)];
  if (userId) conditions.push(eq(loginEvents.userId, userId));
  if (outcome) conditions.push(eq(loginEvents.outcome, outcome));
  if (minScore !== undefined) conditions.push(gte(loginEvents.riskScore, minScore));

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(loginEvents).where(and(...conditions)).orderBy(desc(loginEvents.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(loginEvents).where(and(...conditions)),
  ]);

  const page = Math.floor(offset / limit) + 1;
  res.json(paginated(rows.map((r) => ({ ...r, riskReasons: r.riskReasons ? JSON.parse(r.riskReasons) : [] })), Number(total), page, limit));
});

// GET /api/admin/risk/dashboard — summary stats backing src/pages/admin/RiskDashboard.tsx
router.get('/risk/dashboard', authenticateAdmin, async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const tenantId = req.tenantId;

  const [outcomeCounts, topUsers, signalRows] = await Promise.all([
    db.select({ outcome: loginEvents.outcome, n: count() }).from(loginEvents)
      .where(and(eq(loginEvents.tenantId, tenantId), gte(loginEvents.createdAt, since)))
      .groupBy(loginEvents.outcome),
    db.select({ userId: loginEvents.userId, avgScore: sql<number>`avg(${loginEvents.riskScore})::int`, n: count() })
      .from(loginEvents)
      .where(and(eq(loginEvents.tenantId, tenantId), gte(loginEvents.createdAt, since), sql`${loginEvents.riskScore} is not null`))
      .groupBy(loginEvents.userId)
      .orderBy(desc(sql`avg(${loginEvents.riskScore})`))
      .limit(10),
    db.select({ riskReasons: loginEvents.riskReasons }).from(loginEvents)
      .where(and(eq(loginEvents.tenantId, tenantId), gte(loginEvents.createdAt, since), sql`${loginEvents.riskReasons} is not null`))
      .limit(2000),
  ]);

  const signalCounts: Record<string, number> = {};
  for (const row of signalRows) {
    try {
      const signals = JSON.parse(row.riskReasons || '[]');
      for (const s of signals) signalCounts[s.code] = (signalCounts[s.code] || 0) + 1;
    } catch { /* malformed row, skip */ }
  }

  res.json(success({
    mode: getValue('riskEngine'),
    outcomes: Object.fromEntries(outcomeCounts.map((r) => [r.outcome, r.n])),
    topRiskyUsers: topUsers,
    signalDistribution: signalCounts,
  }));
});

// POST /api/admin/risk/ueba/run — manually trigger the UEBA baseline recompute
// (server/jobs/ueba.job.ts normally runs nightly via the scheduler in server/jobs/scheduler.ts).
router.post('/risk/ueba/run', authenticatePlatformAdmin, async (req, res) => {
  const result = await runUebaBaselineJob();
  res.json(success(result, 'UEBA baseline recompute finished'));
});

export default router;
