import express from 'express';
import { db } from '../../database.js';
import { logAudit, computeAuditHash } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { authenticateAdmin } from '../../middleware/auth.js';
import { success, paginated } from '../../utils/response.js';
import { users, tenants, auditLogs } from '../../schema.js';
import { eq, and, gte, lte, desc, count, getTableColumns, sql } from 'drizzle-orm';

const router = express.Router();

// GET /api/admin/audit
router.get('/audit', authenticateAdmin, async (req, res) => {
  const { action, user_id, start_date, end_date, page = '1', pageSize = '50' } = req.query;
  const tenantId = req.tenantId;

  const pageNum = Math.max(1, parseInt(page as string) || 1);
  const pageSizeNum = Math.min(200, Math.max(1, parseInt(pageSize as string) || 50));
  const offset = (pageNum - 1) * pageSizeNum;

  const conditions: any[] = [];

  if (action) conditions.push(eq(auditLogs.action, action as string));
  if (user_id) conditions.push(eq(auditLogs.userId, user_id as string));
  if (start_date) conditions.push(gte(auditLogs.createdAt, new Date(start_date as string)));
  if (end_date) conditions.push(lte(auditLogs.createdAt, new Date(end_date as string)));
  if (!req.isPlatformAdmin) conditions.push(eq(auditLogs.tenantId, req.tenantId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);

  const logs = await db
    .select({
      ...getTableColumns(auditLogs),
      username: users.username,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.userId, users.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSizeNum)
    .offset(offset);

  res.json(paginated(logs, Number(total), pageNum, pageSizeNum));
});

// GET /api/admin/audit/filter
router.get('/audit/filter', authenticateAdmin, async (req, res) => {
  const { action, user_id, tenant_id, start_date, end_date, limit } = req.query;
  const limitNum = Math.min(500, Math.max(1, parseInt(limit as string) || 100));

  const conditions: any[] = [];

  if (action) conditions.push(eq(auditLogs.action, action as string));
  if (user_id) conditions.push(eq(auditLogs.userId, user_id as string));
  // Tenant-admins are pinned to their own tenant; only a platform-admin may pick
  // an arbitrary tenant_id (or omit it to see every tenant).
  if (!req.isPlatformAdmin) {
    conditions.push(eq(auditLogs.tenantId, req.tenantId));
  } else if (tenant_id) {
    conditions.push(eq(auditLogs.tenantId, tenant_id as string));
  }
  if (start_date) conditions.push(gte(auditLogs.createdAt, new Date(start_date as string)));
  if (end_date) conditions.push(lte(auditLogs.createdAt, new Date(end_date as string)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const logs = await db
    .select({
      ...getTableColumns(auditLogs),
      username: users.username,
      tenantName: tenants.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.userId, users.id))
    .leftJoin(tenants, eq(auditLogs.tenantId, tenants.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limitNum);

  res.json(success(logs));
});

// GET /api/admin/audit/actions
router.get('/audit/actions', authenticateAdmin, async (req, res) => {
  const rows = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .where(req.isPlatformAdmin ? undefined : eq(auditLogs.tenantId, req.tenantId))
    .orderBy(auditLogs.action);

  res.json(success(rows.map((a) => a.action)));
});

// GET /api/admin/audit/verify — hash-chain tamper check.
// The chain is a single global sequence (server/utils/audit.ts serializes every insert with
// pg_advisory_xact_lock so seq is a true total order across tenants), so a tenant-admin's
// filtered view can't just compare adjacent rows in their own result set — the row
// immediately before theirs in the chain might belong to another tenant. Instead we fetch
// just the {seq, hash} of every row in the covered seq range (cheap, no content exposure)
// to check linkage, and recompute each of *this tenant's* rows' own content hash to catch
// tampering of their content specifically.
router.get('/audit/verify', authenticateAdmin, async (req, res) => {
  const limit = Math.min(20000, Math.max(1, parseInt(String(req.query.limit ?? '2000'), 10) || 2000));
  const tenantCond = req.isPlatformAdmin ? undefined : eq(auditLogs.tenantId, req.tenantId);

  const rows = await db.select({
    seq: auditLogs.seq, tenantId: auditLogs.tenantId, action: auditLogs.action, userId: auditLogs.userId,
    details: auditLogs.details, createdAt: auditLogs.createdAt, prevHash: auditLogs.prevHash, hash: auditLogs.hash,
  }).from(auditLogs).where(tenantCond).orderBy(desc(auditLogs.seq)).limit(limit);

  rows.reverse(); // oldest first, for a chronological report

  let hashLookup = new Map<number, string>();
  if (rows.length > 0) {
    const minSeq = rows[0].seq;
    const maxSeq = rows[rows.length - 1].seq;
    const bridge = await db.select({ seq: auditLogs.seq, hash: auditLogs.hash })
      .from(auditLogs)
      .where(and(gte(auditLogs.seq, minSeq - 1), lte(auditLogs.seq, maxSeq)));
    hashLookup = new Map(bridge.map(b => [b.seq, b.hash || '']));
  }

  const issues: { seq: number; type: 'content_tampered' | 'chain_broken' }[] = [];
  for (const row of rows) {
    const expectedHash = computeAuditHash({
      seq: row.seq, tenantId: row.tenantId || 'default', action: row.action, userId: row.userId,
      details: row.details || '', createdAt: row.createdAt as Date, prevHash: row.prevHash,
    });
    if (expectedHash !== row.hash) issues.push({ seq: row.seq, type: 'content_tampered' });

    const expectedPrevHash = row.seq > 1 ? (hashLookup.get(row.seq - 1) ?? null) : null;
    if ((row.prevHash ?? null) !== expectedPrevHash) issues.push({ seq: row.seq, type: 'chain_broken' });
  }

  await logAudit({ req, action: AuditAction.AUDIT_LOG_VERIFIED, userId: req.user!.id, details: JSON.stringify({ checked: rows.length, intact: issues.length === 0 }) });
  res.json(success({ checked: rows.length, intact: issues.length === 0, issues: issues.slice(0, 100) }));
});

// GET /api/admin/audit/export?format=csv|jsonl — streamed so large exports don't buffer
// the whole result set in memory.
router.get('/audit/export', authenticateAdmin, async (req, res) => {
  const format = req.query.format === 'jsonl' ? 'jsonl' : 'csv';
  const tenantCond = req.isPlatformAdmin ? undefined : eq(auditLogs.tenantId, req.tenantId);

  res.setHeader('Content-Disposition', `attachment; filename="audit-log.${format === 'jsonl' ? 'jsonl' : 'csv'}"`);
  res.setHeader('Content-Type', format === 'jsonl' ? 'application/x-ndjson' : 'text/csv');

  if (format === 'csv') {
    res.write('seq,created_at,tenant_id,user_id,action,target_id,ip_address,details\n');
  }

  const pageSize = 1000;
  let lastSeq = 0;
  for (;;) {
    const conditions = tenantCond ? and(tenantCond, sql`${auditLogs.seq} > ${lastSeq}`) : sql`${auditLogs.seq} > ${lastSeq}`;
    const page = await db.select().from(auditLogs).where(conditions).orderBy(auditLogs.seq).limit(pageSize);
    if (page.length === 0) break;

    for (const row of page) {
      if (format === 'jsonl') {
        res.write(JSON.stringify(row) + '\n');
      } else {
        const csvEscape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        res.write([row.seq, row.createdAt?.toISOString(), row.tenantId, row.userId, row.action, row.targetId, row.ipAddress, csvEscape(row.details)].join(',') + '\n');
      }
    }
    lastSeq = page[page.length - 1].seq;
    if (page.length < pageSize) break;
  }

  await logAudit({ req, action: AuditAction.AUDIT_LOG_EXPORTED, userId: req.user!.id, details: `format=${format}` });
  res.end();
});

export default router;
