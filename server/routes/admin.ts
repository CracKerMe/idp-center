import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../database.js';
import { logAudit } from '../utils/audit.js';
import { emailService } from '../services/email.service.js';
import { cleanupExpiredTokens } from '../utils/cleanup.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { success, error, message, paginated, ErrorCode } from '../utils/response.js';
import { revokeAllUserTokens, RevokeReason } from '../utils/token-blacklist.js';
import { getTenantPasswordPolicy } from '../services/password-policy.service.js';
import { parseCidr } from '../middleware/ip-whitelist.js';
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
  sql,
  getTableColumns,
  ne,
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
} from '../validators/admin.validator.js';

const router = express.Router();

// GET /api/admin/users
router.get('/users', authenticateAdmin, validate({ query: listUsersQuerySchema }), async (req, res) => {
  const { page, pageSize, search, tenant_id, is_active } = req.query as any;
  const offset = (page - 1) * pageSize;

  const conditions: any[] = [];

  if (search) {
    conditions.push(or(ilike(users.username, `%${search}%`), ilike(users.email, `%${search}%`)));
  }
  if (tenant_id) {
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
      tenantId: tenant_id || 'default',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });

    await logAudit(
      req.user!.id,
      'admin_create_user',
      req,
      JSON.stringify({ created_username: username, created_email: email, is_admin })
    );

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

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
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
  if (updates.tenant_id !== undefined) updateData.tenantId = updates.tenant_id;

  if (Object.keys(updateData).length === 0) return res.status(400).json(error('No fields to update', ErrorCode.VALIDATION_ERROR));

  updateData.updatedAt = new Date();
  await db.update(users).set(updateData).where(eq(users.id, userId));

  await logAudit(req.user!.id, 'admin_update_user', req, JSON.stringify({ target_user_id: userId, updates }));
  res.json(message('User updated successfully'));
});

// DELETE /api/admin/users/:userId
router.delete('/users/:userId', authenticateAdmin, validate({ params: userIdParamsSchema }), async (req, res) => {
  const { userId } = req.params;

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, userId));
  await logAudit(req.user!.id, 'admin_delete_user', req, JSON.stringify({ target_user_id: userId }));
  res.json(message('User deactivated successfully'));
});

// POST /api/admin/users/:userId/ban
router.post('/users/:userId/ban', authenticateAdmin, validate({ params: userIdParamsSchema }), async (req, res) => {
  const { userId } = req.params;

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, userId));
  await revokeAllUserTokens(userId, RevokeReason.ACCOUNT_DISABLED);
  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId));

  await logAudit(req.user!.id, 'admin_ban_user', req, JSON.stringify({ target_user_id: userId }));
  res.json(message('User banned successfully'));
});

// POST /api/admin/users/:userId/unban
router.post('/users/:userId/unban', authenticateAdmin, validate({ params: userIdParamsSchema }), async (req, res) => {
  const { userId } = req.params;

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.update(users).set({ isActive: true, updatedAt: new Date() }).where(eq(users.id, userId));
  await logAudit(req.user!.id, 'admin_unban_user', req, JSON.stringify({ target_user_id: userId }));
  res.json(message('User unbanned successfully'));
});

// POST /api/admin/users/:userId/reset-password
router.post('/users/:userId/reset-password', authenticateAdmin, validate({ params: userIdParamsSchema }), async (req, res) => {
  const { userId } = req.params;

  const [user] = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

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

    await logAudit(req.user!.id, 'admin_reset_password', req, JSON.stringify({ target_user_id: userId }));
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

  await logAudit(req.user!.id, 'admin_create_client', req, JSON.stringify({ client_id, client_name }), tenantId);
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

  await logAudit(req.user!.id, 'admin_update_client', req, JSON.stringify({ client_id: clientId }), tenantId);
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
  await logAudit(req.user!.id, 'admin_delete_client', req, JSON.stringify({ client_id: clientId }), tenantId);
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

  await logAudit(req.user!.id, 'admin_rotate_client_secret', req, JSON.stringify({ client_id: clientId }), tenantId);
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
  if (tenant_id) conditions.push(eq(auditLogs.tenantId, tenant_id as string));
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
    .orderBy(auditLogs.action);

  res.json(success(rows.map((a) => a.action)));
});

// GET /api/admin/stats
router.get('/stats', authenticateAdmin, async (req, res) => {
  const [{ count: userCount }] = await db.select({ count: count() }).from(users);
  const [{ count: tenantCount }] = await db.select({ count: count() }).from(tenants);
  const [{ count: clientCount }] = await db.select({ count: count() }).from(clients);

  const [{ count: activeTokens }] = await db
    .select({ count: count() })
    .from(accessTokens)
    .where(and(eq(accessTokens.revoked, false), gt(accessTokens.expiresAt, new Date())));

  const [{ count: activeSessions }] = await db.select({ count: count() }).from(sessions);

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [{ count: recentLogins }] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, 'LOGIN_SUCCESS'), gt(auditLogs.createdAt, yesterday)));

  const [{ count: recentRegistrations }] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, 'REGISTER'), gt(auditLogs.createdAt, yesterday)));

  res.json(success({
    users: Number(userCount),
    tenants: Number(tenantCount),
    clients: Number(clientCount),
    activeTokens: Number(activeTokens),
    activeSessions: Number(activeSessions),
    last24h: { logins: Number(recentLogins), registrations: Number(recentRegistrations) },
  }));
});

// GET /api/admin/tenants
router.get('/tenants', authenticateAdmin, async (req, res) => {
  const tenantList = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
  res.json(success(tenantList));
});

// POST /api/admin/tenants
router.post('/tenants', authenticateAdmin, validate({ body: createTenantSchema }), async (req, res) => {
  const { name, domain, settings } = req.body;

  const id = crypto.randomUUID();
  await db.insert(tenants).values({
    id,
    name,
    domain: domain || null,
    settings: JSON.stringify(settings || {}),
  });

  await logAudit(req.user!.id, 'TENANT_CREATE', req, `Created tenant: ${name}`);
  res.json(success({ id }, 'Tenant created successfully'));
});

// PUT /api/admin/tenants/:tenantId
router.put('/tenants/:tenantId', authenticateAdmin, validate({ params: tenantIdParamsSchema, body: updateTenantSchema }), async (req, res) => {
  const { tenantId } = req.params;
  const { name, domain, is_active, settings } = req.body;

  await db.update(tenants).set({
    name,
    domain,
    isActive: is_active,
    settings: JSON.stringify(settings || {}),
  }).where(eq(tenants.id, tenantId));

  await logAudit(req.user!.id, 'TENANT_UPDATE', req, `Updated tenant: ${tenantId}`);
  res.json(message('Tenant updated successfully'));
});

// DELETE /api/admin/tenants/:tenantId
router.delete('/tenants/:tenantId', authenticateAdmin, validate({ params: tenantIdParamsSchema }), async (req, res) => {
  const { tenantId } = req.params;
  if (tenantId === 'default') return res.status(400).json(error('Cannot delete default tenant', ErrorCode.VALIDATION_ERROR));

  await db.update(users).set({ tenantId: 'default', updatedAt: new Date() }).where(eq(users.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));

  await logAudit(req.user!.id, 'TENANT_DELETE', req, `Deleted tenant: ${tenantId}`);
  res.json(message('Tenant deleted successfully'));
});

// GET /api/admin/sessions
router.get('/sessions', authenticateAdmin, async (req, res) => {
  const sessionList = await db.execute(sql`
    SELECT s.id, s.device_info, s.ip_address, s.last_active, s.created_at,
      u.username, u.email,
      (SELECT COUNT(*)::int FROM refresh_tokens rt WHERE rt.user_id = s.user_id AND rt.revoked = false) as active_tokens
    FROM sessions s
    LEFT JOIN users u ON s.user_id = u.id
    ORDER BY s.last_active DESC
  `);
  res.json(success(sessionList));
});

// DELETE /api/admin/sessions/:id
router.delete('/sessions/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!session) return res.status(404).json(error('Session not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, session.userId));
  await db.delete(sessions).where(eq(sessions.id, id));

  await logAudit(req.user!.id, 'ADMIN_SESSION_REVOKED', req, `Session ${id} revoked by admin`);
  res.json(message('Session revoked successfully'));
});

// POST /api/admin/maintenance/cleanup-tokens
router.post('/maintenance/cleanup-tokens', authenticateAdmin, async (req, res) => {
  const result = await cleanupExpiredTokens();
  res.json(success(result, 'Token cleanup completed'));
});

// GET /api/admin/tenants/:tenantId/password-policy
router.get('/tenants/:tenantId/password-policy', authenticateAdmin, validate({ params: tenantIdParamsSchema }), async (req, res) => {
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
router.put('/tenants/:tenantId/password-policy', authenticateAdmin, validate({ params: tenantIdParamsSchema, body: passwordPolicySchema }), async (req, res) => {
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
router.get('/tenants/:tenantId/ip-whitelist', authenticateAdmin, validate({ params: tenantIdParamsSchema }), async (req, res) => {
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
router.post('/tenants/:tenantId/ip-whitelist', authenticateAdmin, validate({ params: tenantIdParamsSchema, body: ipWhitelistEntrySchema }), async (req, res) => {
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

  await logAudit(createdBy, 'IP_WHITELIST_ADDED', req, JSON.stringify({ tenant_id: tenantId, cidr, description }), tenantId);
  res.status(201).json(success({ id }, 'IP whitelist entry added'));
});

// DELETE /api/admin/tenants/:tenantId/ip-whitelist/:entryId
router.delete('/tenants/:tenantId/ip-whitelist/:entryId', authenticateAdmin, async (req, res) => {
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
  await logAudit(userId, 'IP_WHITELIST_REMOVED', req, JSON.stringify({ tenant_id: tenantId, entry_id: entryId }), tenantId);
  res.json(message('IP whitelist entry removed'));
});

export default router;
