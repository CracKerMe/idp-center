import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../database.js';
import { logAudit, computeAuditHash } from '../utils/audit.js';
import { AuditAction, PRIVILEGED_ACTIONS, ANOMALY_ACTIONS } from '../utils/audit-actions.js';
import { emailService } from '../services/email.service.js';
import { cleanupExpiredTokens } from '../utils/cleanup.js';
import { authenticateAdmin, authenticatePlatformAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { success, error, message, paginated, ErrorCode } from '../utils/response.js';
import { revokeAllUserTokens, RevokeReason } from '../utils/token-blacklist.js';
import { getTenantPasswordPolicy } from '../services/password-policy.service.js';
import { parseCidr } from '../middleware/ip-whitelist.js';
import { encryptToken, decryptToken } from '../services/crypto.js';
import {
  users,
  clients,
  tenants,
  auditLogs,
  sessions,
  refreshTokens,
  accessTokens,
  tenantPasswordPolicies,
  tenantIpWhitelist,
  passwordResets,
  identityProviders,
  mfaFactors,
  accountDeletionRequests,
} from '../schema.js';
import {
  eq,
  and,
  or,
  like,
  ilike,
  lt,
  gt,
  gte,
  lte,
  desc,
  asc,
  count,
  countDistinct,
  sql,
  getTableColumns,
  ne,
  inArray,
} from 'drizzle-orm';
import {
  userIdParamsSchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  clientIdParamsSchema,
  createClientSchema,
  updateClientSchema,
  listUsersQuerySchema,
  tenantIdParamsSchema,
  createTenantSchema,
  updateTenantSchema,
  passwordPolicySchema,
  ipWhitelistEntrySchema,
  createIdpSchema,
  updateIdpSchema,
  idpIdParamsSchema,
} from '../validators/admin.validator.js';

const router = express.Router();

/**
 * Guards the :tenantId path param on per-tenant admin sub-resources (password policy,
 * IP whitelist). Without this a tenant-admin could manage another tenant's policy just
 * by knowing its id — req.tenantId (from X-Tenant-ID) was never cross-checked against it.
 */
function requireOwnTenantOrPlatformAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.isPlatformAdmin || req.params.tenantId === req.tenantId) return next();
  return res.status(403).json(error('Cannot manage another tenant', ErrorCode.AUTH_UNAUTHORIZED));
}

/**
 * Loads a user by id, but only if it belongs to the caller's tenant (unless the
 * caller is a platform-admin). Returns null both when the user doesn't exist and
 * when it belongs to another tenant — callers respond 404 either way so tenant
 * boundaries aren't leaked through a distinguishable error.
 */
async function findUserInScope(req: express.Request, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  if (!req.isPlatformAdmin && user.tenantId !== req.tenantId) return null;
  return user;
}

// GET /api/admin/users
router.get('/users', authenticateAdmin, validate({ query: listUsersQuerySchema }), async (req, res) => {
  const { page, pageSize, search, tenant_id, is_active } = req.query as any;
  const offset = (page - 1) * pageSize;

  const conditions: any[] = [];

  if (search) {
    conditions.push(or(ilike(users.username, `%${search}%`), ilike(users.email, `%${search}%`)));
  }
  // Tenant-admins are hard-scoped to their own tenant regardless of what they pass —
  // only a platform-admin may list across tenants or pick an arbitrary tenant_id.
  if (!req.isPlatformAdmin) {
    conditions.push(eq(users.tenantId, req.tenantId));
  } else if (tenant_id) {
    conditions.push(eq(users.tenantId, tenant_id));
  }
  if (is_active !== undefined) {
    conditions.push(eq(users.isActive, is_active));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(users).where(where);

  const userList = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      fullName: users.fullName,
      isActive: users.isActive,
      isAdmin: users.isAdmin,
      otpEnabled: users.otpEnabled,
      tenantId: users.tenantId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset(offset);

  res.json(paginated(userList, Number(total), page, pageSize));
});

// POST /api/admin/users
router.post('/users', authenticateAdmin, validate({ body: adminCreateUserSchema }), async (req, res) => {
  const { username, email, password, full_name, phone, is_admin, tenant_id } = req.body;
  // A tenant-admin can only ever create users in their own tenant — only a
  // platform-admin may target an arbitrary tenant_id.
  const targetTenantId = req.isPlatformAdmin ? (tenant_id || 'default') : req.tenantId;

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();

    await db.insert(users).values({
      id: userId,
      username,
      email,
      passwordHash: password_hash,
      fullName: full_name || null,
      phone: phone || null,
      isAdmin: is_admin || false,
      tenantId: targetTenantId,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });

    await logAudit({ req, action: AuditAction.ADMIN_USER_CREATE, userId: req.user!.id, details: JSON.stringify({ created_username: username, created_email: email, is_admin }), tenantId: targetTenantId });

    res.json(success({ id: userId }, 'User created successfully'));
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.message?.includes('UNIQUE constraint failed')) {
      return res.status(400).json(error('Username or email already exists', ErrorCode.RESOURCE_ALREADY_EXISTS));
    }
    res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }
});

// PUT /api/admin/users/:userId
router.put('/users/:userId', authenticateAdmin, validate({ params: userIdParamsSchema, body: adminUpdateUserSchema }), async (req, res) => {
  const { userId } = req.params;
  const updates = req.body;

  const user = await findUserInScope(req, userId);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  const updateData: Record<string, any> = {};

  if (updates.username !== undefined) updateData.username = updates.username;
  if (updates.email !== undefined) updateData.email = updates.email;
  if (updates.full_name !== undefined) updateData.fullName = updates.full_name;
  if (updates.phone !== undefined) updateData.phone = updates.phone;
  if (updates.is_admin !== undefined) {
    updateData.isAdmin = updates.is_admin;
    if (updates.is_admin) {
      updateData.emailVerified = true;
      updateData.emailVerifiedAt = new Date();
    }
  }
  if (updates.is_active !== undefined) updateData.isActive = updates.is_active;
  // Moving a user to another tenant is a platform-wide operation — a tenant-admin
  // could otherwise use it to hop their own account (or anyone's) into a tenant
  // they don't control.
  if (updates.tenant_id !== undefined && req.isPlatformAdmin) updateData.tenantId = updates.tenant_id;

  if (Object.keys(updateData).length === 0) return res.status(400).json(error('No fields to update', ErrorCode.VALIDATION_ERROR));

  updateData.updatedAt = new Date();
  await db.update(users).set(updateData).where(eq(users.id, userId));

  await logAudit({ req, action: AuditAction.ADMIN_USER_UPDATE, userId: req.user!.id, details: JSON.stringify({ target_user_id: userId, updates }) });
  res.json(message('User updated successfully'));
});

// DELETE /api/admin/users/:userId
router.delete('/users/:userId', authenticateAdmin, validate({ params: userIdParamsSchema }), async (req, res) => {
  const { userId } = req.params;

  const user = await findUserInScope(req, userId);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, userId));
  await logAudit({ req, action: AuditAction.ADMIN_USER_DELETE, userId: req.user!.id, details: JSON.stringify({ target_user_id: userId }) });
  res.json(message('User deactivated successfully'));
});

// POST /api/admin/users/:userId/ban
router.post('/users/:userId/ban', authenticateAdmin, validate({ params: userIdParamsSchema }), async (req, res) => {
  const { userId } = req.params;

  const user = await findUserInScope(req, userId);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, userId));
  await revokeAllUserTokens(userId, RevokeReason.ACCOUNT_DISABLED);
  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId));

  await logAudit({ req, action: AuditAction.ADMIN_USER_BAN, userId: req.user!.id, details: JSON.stringify({ target_user_id: userId }) });
  res.json(message('User banned successfully'));
});

// POST /api/admin/users/:userId/unban
router.post('/users/:userId/unban', authenticateAdmin, validate({ params: userIdParamsSchema }), async (req, res) => {
  const { userId } = req.params;

  const user = await findUserInScope(req, userId);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.update(users).set({ isActive: true, updatedAt: new Date() }).where(eq(users.id, userId));
  await logAudit({ req, action: AuditAction.ADMIN_USER_UNBAN, userId: req.user!.id, details: JSON.stringify({ target_user_id: userId }) });
  res.json(message('User unbanned successfully'));
});

// POST /api/admin/users/:userId/reset-password
router.post('/users/:userId/reset-password', authenticateAdmin, validate({ params: userIdParamsSchema }), async (req, res) => {
  const { userId } = req.params;

  const user = await findUserInScope(req, userId);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  try {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.insert(passwordResets).values({
      id: crypto.randomUUID(),
      userId,
      token: resetToken,
      expiresAt,
    });

    await emailService.sendPasswordResetEmail(user.email, resetToken, user.username);

    await logAudit({ req, action: AuditAction.ADMIN_PASSWORD_RESET, userId: req.user!.id, details: JSON.stringify({ target_user_id: userId }) });
    res.json(message('Password reset email sent'));
  } catch (err) {
    res.status(500).json(error('Internal server error', 'SERVER_ERROR'));
  }
});

// GET /api/admin/clients
router.get('/clients', authenticateAdmin, async (req, res) => {
  const tenantId = req.tenantId;
  const clientList = await db
    .select({
      id: clients.id,
      clientId: clients.clientId,
      clientName: clients.clientName,
      redirectUris: clients.redirectUris,
      grantTypes: clients.grantTypes,
      tenantId: clients.tenantId,
      createdAt: clients.createdAt,
    })
    .from(clients)
    .where(eq(clients.tenantId, tenantId))
    .orderBy(desc(clients.createdAt));

  res.json(success(clientList));
});

// POST /api/admin/clients
router.post('/clients', authenticateAdmin, validate({ body: createClientSchema }), async (req, res) => {
  const { client_name, redirect_uris, grant_types } = req.body;
  const tenantId = req.tenantId;
  const client_id = crypto.randomBytes(8).toString('hex');
  const client_secret = crypto.randomBytes(16).toString('hex');
  const id = crypto.randomUUID();

  await db.insert(clients).values({
    id,
    clientId: client_id,
    clientSecret: client_secret,
    clientName: client_name,
    redirectUris: redirect_uris,
    grantTypes: grant_types || 'authorization_code',
    tenantId,
  });

  await logAudit({ req, action: AuditAction.ADMIN_CLIENT_CREATE, userId: req.user!.id, details: JSON.stringify({ client_id, client_name }), tenantId: tenantId });
  res.json(success({ client_id, client_secret }, 'Client created successfully'));
});

// PUT /api/admin/clients/:clientId
router.put('/clients/:clientId', authenticateAdmin, validate({ params: clientIdParamsSchema, body: updateClientSchema }), async (req, res) => {
  const { clientId } = req.params;
  const updates = req.body;
  const tenantId = req.tenantId;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) return res.status(404).json(error('Client not found', ErrorCode.RESOURCE_NOT_FOUND));

  const updateData: Record<string, any> = {};

  if (updates.client_name !== undefined) updateData.clientName = updates.client_name;
  if (updates.redirect_uris !== undefined) {
    updateData.redirectUris = typeof updates.redirect_uris === 'string' ? updates.redirect_uris : JSON.stringify(updates.redirect_uris);
  }
  if (updates.grant_types !== undefined) updateData.grantTypes = updates.grant_types;

  if (Object.keys(updateData).length === 0) return res.status(400).json(error('No fields to update', ErrorCode.VALIDATION_ERROR));

  await db.update(clients).set(updateData).where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)));

  await logAudit({ req, action: AuditAction.ADMIN_CLIENT_UPDATE, userId: req.user!.id, details: JSON.stringify({ client_id: clientId }), tenantId: tenantId });
  res.json(message('Client updated successfully'));
});

// DELETE /api/admin/clients/:clientId
router.delete('/clients/:clientId', authenticateAdmin, validate({ params: clientIdParamsSchema }), async (req, res) => {
  const { clientId } = req.params;
  const tenantId = req.tenantId;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) return res.status(404).json(error('Client not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.delete(clients).where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)));
  await logAudit({ req, action: AuditAction.ADMIN_CLIENT_DELETE, userId: req.user!.id, details: JSON.stringify({ client_id: clientId }), tenantId: tenantId });
  res.json(message('Client deleted successfully'));
});

// POST /api/admin/clients/:clientId/rotate-secret
router.post('/clients/:clientId/rotate-secret', authenticateAdmin, validate({ params: clientIdParamsSchema }), async (req, res) => {
  const { clientId } = req.params;
  const tenantId = req.tenantId;

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) return res.status(404).json(error('Client not found', ErrorCode.RESOURCE_NOT_FOUND));

  const newSecret = crypto.randomBytes(16).toString('hex');
  await db.update(clients).set({ clientSecret: newSecret }).where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)));

  await logAudit({ req, action: AuditAction.ADMIN_CLIENT_SECRET_ROTATE, userId: req.user!.id, details: JSON.stringify({ client_id: clientId }), tenantId: tenantId });
  res.json(success({ client_secret: newSecret }, 'Secret rotated successfully'));
});

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

// GET /api/admin/tenants
router.get('/tenants', authenticatePlatformAdmin, async (req, res) => {
  const tenantList = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
  res.json(success(tenantList));
});

// POST /api/admin/tenants
router.post('/tenants', authenticatePlatformAdmin, validate({ body: createTenantSchema }), async (req, res) => {
  const { name, domain, settings } = req.body;

  const id = crypto.randomUUID();
  await db.insert(tenants).values({
    id,
    name,
    domain: domain || null,
    settings: JSON.stringify(settings || {}),
  });

  await logAudit({ req, action: AuditAction.TENANT_CREATE, userId: req.user!.id, details: `Created tenant: ${name}` });
  res.json(success({ id }, 'Tenant created successfully'));
});

// PUT /api/admin/tenants/:tenantId
router.put('/tenants/:tenantId', authenticatePlatformAdmin, validate({ params: tenantIdParamsSchema, body: updateTenantSchema }), async (req, res) => {
  const { tenantId } = req.params;
  const { name, domain, is_active, settings } = req.body;

  await db.update(tenants).set({
    name,
    domain,
    isActive: is_active,
    settings: JSON.stringify(settings || {}),
  }).where(eq(tenants.id, tenantId));

  await logAudit({ req, action: AuditAction.TENANT_UPDATE, userId: req.user!.id, details: `Updated tenant: ${tenantId}` });
  res.json(message('Tenant updated successfully'));
});

// DELETE /api/admin/tenants/:tenantId
router.delete('/tenants/:tenantId', authenticatePlatformAdmin, validate({ params: tenantIdParamsSchema }), async (req, res) => {
  const { tenantId } = req.params;
  if (tenantId === 'default') return res.status(400).json(error('Cannot delete default tenant', ErrorCode.VALIDATION_ERROR));

  await db.update(users).set({ tenantId: 'default', updatedAt: new Date() }).where(eq(users.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));

  await logAudit({ req, action: AuditAction.TENANT_DELETE, userId: req.user!.id, details: `Deleted tenant: ${tenantId}` });
  res.json(message('Tenant deleted successfully'));
});

// GET /api/admin/sessions
router.get('/sessions', authenticateAdmin, async (req, res) => {
  const tenantFilter = req.isPlatformAdmin ? sql`` : sql`WHERE u.tenant_id = ${req.tenantId}`;
  const sessionList = await db.execute(sql`
    SELECT s.id, s.device_info, s.ip_address, s.last_active, s.created_at,
      u.username, u.email,
      (SELECT COUNT(*)::int FROM refresh_tokens rt WHERE rt.user_id = s.user_id AND rt.revoked = false) as active_tokens
    FROM sessions s
    LEFT JOIN users u ON s.user_id = u.id
    ${tenantFilter}
    ORDER BY s.last_active DESC
  `);
  res.json(success(sessionList));
});

// DELETE /api/admin/sessions/:id
router.delete('/sessions/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!session) return res.status(404).json(error('Session not found', ErrorCode.RESOURCE_NOT_FOUND));

  if (!req.isPlatformAdmin) {
    const [owner] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, session.userId)).limit(1);
    if (!owner || owner.tenantId !== req.tenantId) return res.status(404).json(error('Session not found', ErrorCode.RESOURCE_NOT_FOUND));
  }

  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, session.userId));
  await db.delete(sessions).where(eq(sessions.id, id));

  await logAudit({ req, action: AuditAction.ADMIN_SESSION_REVOKED, userId: req.user!.id, details: `Session ${id} revoked by admin` });
  res.json(message('Session revoked successfully'));
});

// POST /api/admin/maintenance/cleanup-tokens — global maintenance, platform-admin only.
router.post('/maintenance/cleanup-tokens', authenticatePlatformAdmin, async (req, res) => {
  const result = await cleanupExpiredTokens();
  res.json(success(result, 'Token cleanup completed'));
});

// GET /api/admin/tenants/:tenantId/password-policy
router.get('/tenants/:tenantId/password-policy', authenticateAdmin, requireOwnTenantOrPlatformAdmin, validate({ params: tenantIdParamsSchema }), async (req, res) => {
  const { tenantId } = req.params;
  const policy = await getTenantPasswordPolicy(tenantId);

  const [row] = await db
    .select({ tenantId: tenantPasswordPolicies.tenantId, updatedAt: tenantPasswordPolicies.updatedAt })
    .from(tenantPasswordPolicies)
    .where(eq(tenantPasswordPolicies.tenantId, tenantId))
    .limit(1);

  res.json(success({
    tenant_id: tenantId,
    ...policy,
    updated_at: row?.updatedAt ?? null,
  }));
});

// PUT /api/admin/tenants/:tenantId/password-policy
router.put('/tenants/:tenantId/password-policy', authenticateAdmin, requireOwnTenantOrPlatformAdmin, validate({ params: tenantIdParamsSchema, body: passwordPolicySchema }), async (req, res) => {
  const { tenantId } = req.params;
  const { min_length, history_count, rotation_enabled, rotation_period_days } = req.body;

  await db.insert(tenantPasswordPolicies).values({
    id: crypto.randomUUID(),
    tenantId,
    minLength: min_length,
    historyCount: history_count,
    rotationEnabled: rotation_enabled,
    rotationPeriodDays: rotation_period_days,
  }).onConflictDoUpdate({
    target: tenantPasswordPolicies.tenantId,
    set: {
      minLength: min_length,
      historyCount: history_count,
      rotationEnabled: rotation_enabled,
      rotationPeriodDays: rotation_period_days,
      updatedAt: new Date(),
    },
  });

  res.json(message('Password policy updated successfully'));
});

// GET /api/admin/tenants/:tenantId/ip-whitelist
router.get('/tenants/:tenantId/ip-whitelist', authenticateAdmin, requireOwnTenantOrPlatformAdmin, validate({ params: tenantIdParamsSchema }), async (req, res) => {
  const { tenantId } = req.params;

  const entries = await db
    .select({
      id: tenantIpWhitelist.id,
      cidr: tenantIpWhitelist.cidr,
      description: tenantIpWhitelist.description,
      createdBy: tenantIpWhitelist.createdBy,
      createdAt: tenantIpWhitelist.createdAt,
    })
    .from(tenantIpWhitelist)
    .where(eq(tenantIpWhitelist.tenantId, tenantId))
    .orderBy(asc(tenantIpWhitelist.createdAt));

  res.json(success(entries));
});

// POST /api/admin/tenants/:tenantId/ip-whitelist
router.post('/tenants/:tenantId/ip-whitelist', authenticateAdmin, requireOwnTenantOrPlatformAdmin, validate({ params: tenantIdParamsSchema, body: ipWhitelistEntrySchema }), async (req, res) => {
  const { tenantId } = req.params;
  const { cidr, description } = req.body;

  // Validate CIDR format
  if (!parseCidr(cidr)) {
    return res.status(400).json(error('Invalid CIDR format', ErrorCode.INVALID_CIDR_FORMAT));
  }

  const id = crypto.randomUUID();
  const createdBy = req.user?.id || null;

  try {
    await db.insert(tenantIpWhitelist).values({
      id,
      tenantId,
      cidr,
      description: description || null,
      createdBy,
    });
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json(error('CIDR already exists for this tenant', ErrorCode.CIDR_ALREADY_EXISTS));
    }
    return res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }

  await logAudit({ req, action: AuditAction.IP_WHITELIST_ADDED, userId: createdBy, details: JSON.stringify({ tenant_id: tenantId, cidr, description }), tenantId: tenantId });
  res.status(201).json(success({ id }, 'IP whitelist entry added'));
});

// DELETE /api/admin/tenants/:tenantId/ip-whitelist/:entryId
router.delete('/tenants/:tenantId/ip-whitelist/:entryId', authenticateAdmin, requireOwnTenantOrPlatformAdmin, async (req, res) => {
  const { tenantId, entryId } = req.params;

  const [entry] = await db
    .select({ id: tenantIpWhitelist.id })
    .from(tenantIpWhitelist)
    .where(and(eq(tenantIpWhitelist.id, entryId), eq(tenantIpWhitelist.tenantId, tenantId)))
    .limit(1);

  if (!entry) {
    return res.status(404).json(error('IP whitelist entry not found', ErrorCode.RESOURCE_NOT_FOUND));
  }

  await db
    .delete(tenantIpWhitelist)
    .where(and(eq(tenantIpWhitelist.id, entryId), eq(tenantIpWhitelist.tenantId, tenantId)));

  const userId = req.user?.id || null;
  await logAudit({ req, action: AuditAction.IP_WHITELIST_REMOVED, userId: userId, details: JSON.stringify({ tenant_id: tenantId, entry_id: entryId }), tenantId: tenantId });
  res.json(message('IP whitelist entry removed'));
});

// --- Identity providers (federation, plan §2.2) ---

const IDP_SECRET_KEYS = ['clientSecret', 'bindPassword', 'spPrivateKey'];

/** Never echo back secrets in a GET/list response — the admin re-enters them to change them. */
function redactIdpConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...cfg };
  for (const key of IDP_SECRET_KEYS) {
    if (redacted[key]) redacted[key] = '••••••••';
  }
  return redacted;
}

function idpToResponse(row: typeof identityProviders.$inferSelect) {
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(decryptToken(row.configEnc)); } catch { /* leave empty on decrypt failure */ }
  return {
    id: row.id,
    alias: row.alias,
    type: row.type,
    displayName: row.displayName,
    enabled: row.enabled,
    config: redactIdpConfig(config),
    attributeMapping: JSON.parse(row.attributeMapping || '{}'),
    jitProvisioning: row.jitProvisioning,
    linkByVerifiedEmail: row.linkByVerifiedEmail,
    defaultRoles: row.defaultRoles,
    emailDomains: row.emailDomains,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /api/admin/idps
router.get('/idps', authenticateAdmin, async (req, res) => {
  const rows = await db.select().from(identityProviders).where(eq(identityProviders.tenantId, req.tenantId)).orderBy(desc(identityProviders.createdAt));
  res.json(success(rows.map(idpToResponse)));
});

// POST /api/admin/idps
router.post('/idps', authenticateAdmin, validate({ body: createIdpSchema }), async (req, res) => {
  const { alias, type, displayName, enabled, config: idpConfig, attributeMapping, jitProvisioning, linkByVerifiedEmail, defaultRoles, emailDomains } = req.body;
  const id = crypto.randomUUID();

  try {
    await db.insert(identityProviders).values({
      id,
      tenantId: req.tenantId,
      alias,
      type,
      displayName,
      enabled: enabled ?? true,
      configEnc: encryptToken(JSON.stringify(idpConfig)),
      attributeMapping: JSON.stringify(attributeMapping || {}),
      jitProvisioning: jitProvisioning ?? true,
      linkByVerifiedEmail: linkByVerifiedEmail ?? false,
      defaultRoles: defaultRoles || null,
      emailDomains: emailDomains || null,
    });
  } catch (err: any) {
    if (err.message?.includes('duplicate key')) return res.status(409).json(error('An identity provider with this alias already exists', ErrorCode.RESOURCE_ALREADY_EXISTS));
    return res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }

  await logAudit({ req, action: AuditAction.IDP_CREATED, userId: req.user!.id, details: JSON.stringify({ alias, type }), tenantId: req.tenantId });
  res.status(201).json(success({ id }, 'Identity provider created'));
});

// PUT /api/admin/idps/:id
router.put('/idps/:id', authenticateAdmin, validate({ params: idpIdParamsSchema, body: updateIdpSchema }), async (req, res) => {
  const [existing] = await db.select().from(identityProviders).where(and(eq(identityProviders.id, req.params.id), eq(identityProviders.tenantId, req.tenantId))).limit(1);
  if (!existing) return res.status(404).json(error('Identity provider not found', ErrorCode.RESOURCE_NOT_FOUND));

  const { displayName, enabled, config: idpConfig, attributeMapping, jitProvisioning, linkByVerifiedEmail, defaultRoles, emailDomains } = req.body;
  const updateData: Record<string, any> = { updatedAt: new Date() };

  if (displayName !== undefined) updateData.displayName = displayName;
  if (enabled !== undefined) updateData.enabled = enabled;
  if (attributeMapping !== undefined) updateData.attributeMapping = JSON.stringify(attributeMapping);
  if (jitProvisioning !== undefined) updateData.jitProvisioning = jitProvisioning;
  if (linkByVerifiedEmail !== undefined) updateData.linkByVerifiedEmail = linkByVerifiedEmail;
  if (defaultRoles !== undefined) updateData.defaultRoles = defaultRoles;
  if (emailDomains !== undefined) updateData.emailDomains = emailDomains;

  if (idpConfig !== undefined) {
    // Merge onto the existing decrypted config so the admin can update one field (e.g.
    // displayName) via PUT without being forced to re-submit every secret every time —
    // fields sent back as the "••••••••" placeholder are left untouched rather than
    // overwritten with the literal placeholder string.
    let current: Record<string, unknown> = {};
    try { current = JSON.parse(decryptToken(existing.configEnc)); } catch { /* start fresh on decrypt failure */ }
    const merged = { ...current, ...(idpConfig as Record<string, unknown>) };
    for (const key of IDP_SECRET_KEYS) {
      if (merged[key] === '••••••••') merged[key] = current[key];
    }
    updateData.configEnc = encryptToken(JSON.stringify(merged));
  }

  await db.update(identityProviders).set(updateData).where(eq(identityProviders.id, req.params.id));
  await logAudit({ req, action: AuditAction.IDP_UPDATED, userId: req.user!.id, details: JSON.stringify({ id: req.params.id }), tenantId: req.tenantId });
  res.json(message('Identity provider updated'));
});

// DELETE /api/admin/idps/:id
router.delete('/idps/:id', authenticateAdmin, validate({ params: idpIdParamsSchema }), async (req, res) => {
  const [existing] = await db.select({ id: identityProviders.id }).from(identityProviders).where(and(eq(identityProviders.id, req.params.id), eq(identityProviders.tenantId, req.tenantId))).limit(1);
  if (!existing) return res.status(404).json(error('Identity provider not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.delete(identityProviders).where(eq(identityProviders.id, req.params.id));
  await logAudit({ req, action: AuditAction.IDP_DELETED, userId: req.user!.id, details: JSON.stringify({ id: req.params.id }), tenantId: req.tenantId });
  res.json(message('Identity provider deleted'));
});

export default router;
