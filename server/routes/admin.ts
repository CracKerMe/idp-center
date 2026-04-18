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
} from '../validators/admin.validator.js';

const router = express.Router();

// GET /api/admin/users
router.get('/users', authenticateAdmin, validate({ query: listUsersQuerySchema }), (req, res) => {
  const { page, pageSize, search, tenant_id, is_active } = req.query as any;
  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (search) {
    whereClause += ' AND (username LIKE ? OR email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (tenant_id) {
    whereClause += ' AND tenant_id = ?';
    params.push(tenant_id);
  }
  if (is_active !== undefined) {
    whereClause += ' AND is_active = ?';
    params.push(is_active);
  }

  const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
  const total = (db.prepare(countQuery).get(...params) as any).total;

  const dataQuery = `
    SELECT id, username, email, full_name, is_active, is_admin, otp_enabled, tenant_id, created_at
    FROM users ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  const users = db.prepare(dataQuery).all(...params, pageSize, offset);

  res.json(paginated(users, total, page, pageSize));
});

// POST /api/admin/users
router.post('/users', authenticateAdmin, validate({ body: adminCreateUserSchema }), async (req, res) => {
  const { username, email, password, full_name, phone, is_admin, tenant_id } = req.body;

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();

    db.prepare(
      'INSERT INTO users (id, username, email, password_hash, full_name, phone, is_admin, tenant_id, email_verified, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)'
    ).run(userId, username, email, password_hash, full_name || null, phone || null, is_admin ? 1 : 0, tenant_id || 'default', new Date().toISOString());

    logAudit(
      (req as any).user.id,
      'admin_create_user',
      req,
      JSON.stringify({ created_username: username, created_email: email, is_admin })
    );

    res.json(success({ id: userId }, 'User created successfully'));
  } catch (err: any) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json(error('Username or email already exists', ErrorCode.RESOURCE_ALREADY_EXISTS));
    }
    res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }
});

// PUT /api/admin/users/:userId
router.put('/users/:userId', authenticateAdmin, validate({ params: userIdParamsSchema, body: adminUpdateUserSchema }), (req, res) => {
  const { userId } = req.params;
  const updates = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  const setClauses: string[] = [];
  const params: any[] = [];

  if (updates.username !== undefined) { setClauses.push('username = ?'); params.push(updates.username); }
  if (updates.email !== undefined) { setClauses.push('email = ?'); params.push(updates.email); }
  if (updates.full_name !== undefined) { setClauses.push('full_name = ?'); params.push(updates.full_name); }
  if (updates.phone !== undefined) { setClauses.push('phone = ?'); params.push(updates.phone); }
  if (updates.is_admin !== undefined) {
    setClauses.push('is_admin = ?');
    params.push(updates.is_admin ? 1 : 0);
    if (updates.is_admin) {
      setClauses.push('email_verified = 1');
      setClauses.push('email_verified_at = ?');
      params.push(new Date().toISOString());
    }
  }
  if (updates.is_active !== undefined) { setClauses.push('is_active = ?'); params.push(updates.is_active ? 1 : 0); }
  if (updates.tenant_id !== undefined) { setClauses.push('tenant_id = ?'); params.push(updates.tenant_id); }

  if (setClauses.length === 0) return res.status(400).json(error('No fields to update', ErrorCode.VALIDATION_ERROR));

  params.push(userId);
  db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  logAudit((req as any).user.id, 'admin_update_user', req, JSON.stringify({ target_user_id: userId, updates }));
  res.json(message('User updated successfully'));
});

// DELETE /api/admin/users/:userId
router.delete('/users/:userId', authenticateAdmin, validate({ params: userIdParamsSchema }), (req, res) => {
  const { userId } = req.params;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
  logAudit((req as any).user.id, 'admin_delete_user', req, JSON.stringify({ target_user_id: userId }));
  res.json(message('User deactivated successfully'));
});

// POST /api/admin/users/:userId/ban
router.post('/users/:userId/ban', authenticateAdmin, validate({ params: userIdParamsSchema }), (req, res) => {
  const { userId } = req.params;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
  revokeAllUserTokens(userId, RevokeReason.ACCOUNT_DISABLED);
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);

  logAudit((req as any).user.id, 'admin_ban_user', req, JSON.stringify({ target_user_id: userId }));
  res.json(message('User banned successfully'));
});

// POST /api/admin/users/:userId/unban
router.post('/users/:userId/unban', authenticateAdmin, validate({ params: userIdParamsSchema }), (req, res) => {
  const { userId } = req.params;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(userId);
  logAudit((req as any).user.id, 'admin_unban_user', req, JSON.stringify({ target_user_id: userId }));
  res.json(message('User unbanned successfully'));
});

// POST /api/admin/users/:userId/reset-password
router.post('/users/:userId/reset-password', authenticateAdmin, validate({ params: userIdParamsSchema }), async (req, res) => {
  const { userId } = req.params;

  const user = db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(userId) as any;
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  try {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare('INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(), userId, resetToken, expiresAt
    );

    await emailService.sendPasswordResetEmail(user.email, resetToken, user.username);

    logAudit((req as any).user.id, 'admin_reset_password', req, JSON.stringify({ target_user_id: userId }));
    res.json(message('Password reset email sent'));
  } catch (err) {
    res.status(500).json(error('Internal server error', 'SERVER_ERROR'));
  }
});

// GET /api/admin/clients
router.get('/clients', authenticateAdmin, (req, res) => {
  const tenantId = (req as any).tenantId;
  const clients = db.prepare('SELECT id, client_id, client_name, redirect_uris, grant_types, tenant_id, created_at FROM clients WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
  res.json(success(clients));
});

// POST /api/admin/clients
router.post('/clients', authenticateAdmin, validate({ body: createClientSchema }), (req, res) => {
  const { client_name, redirect_uris, grant_types } = req.body;
  const tenantId = (req as any).tenantId;
  const client_id = crypto.randomBytes(8).toString('hex');
  const client_secret = crypto.randomBytes(16).toString('hex');
  const id = crypto.randomUUID();

  db.prepare('INSERT INTO clients (id, client_id, client_secret, client_name, redirect_uris, grant_types, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, client_id, client_secret, client_name, redirect_uris, grant_types || 'authorization_code', tenantId
  );
  
  logAudit((req as any).user.id, 'admin_create_client', req, JSON.stringify({ client_id, client_name }), tenantId);
  res.json(success({ client_id, client_secret }, 'Client created successfully'));
});

// PUT /api/admin/clients/:clientId
router.put('/clients/:clientId', authenticateAdmin, validate({ params: clientIdParamsSchema, body: updateClientSchema }), (req, res) => {
  const { clientId } = req.params;
  const updates = req.body;
  const tenantId = (req as any).tenantId;
 
  const client = db.prepare('SELECT id FROM clients WHERE client_id = ? AND tenant_id = ?').get(clientId, tenantId);
  if (!client) return res.status(404).json(error('Client not found', ErrorCode.RESOURCE_NOT_FOUND));

  const setClauses: string[] = [];
  const params: any[] = [];

  if (updates.client_name !== undefined) { setClauses.push('client_name = ?'); params.push(updates.client_name); }
  if (updates.redirect_uris !== undefined) {
    setClauses.push('redirect_uris = ?');
    params.push(typeof updates.redirect_uris === 'string' ? updates.redirect_uris : JSON.stringify(updates.redirect_uris));
  }
  if (updates.grant_types !== undefined) { setClauses.push('grant_types = ?'); params.push(updates.grant_types); }

  if (setClauses.length === 0) return res.status(400).json(error('No fields to update', ErrorCode.VALIDATION_ERROR));

  params.push(clientId, tenantId);
  db.prepare(`UPDATE clients SET ${setClauses.join(', ')} WHERE client_id = ? AND tenant_id = ?`).run(...params);
 
  logAudit((req as any).user.id, 'admin_update_client', req, JSON.stringify({ client_id: clientId }), tenantId);
  res.json(message('Client updated successfully'));
});

// DELETE /api/admin/clients/:clientId
router.delete('/clients/:clientId', authenticateAdmin, validate({ params: clientIdParamsSchema }), (req, res) => {
  const { clientId } = req.params;
  const tenantId = (req as any).tenantId;
 
  const client = db.prepare('SELECT id FROM clients WHERE client_id = ? AND tenant_id = ?').get(clientId, tenantId);
  if (!client) return res.status(404).json(error('Client not found', ErrorCode.RESOURCE_NOT_FOUND));
 
  db.prepare('DELETE FROM clients WHERE client_id = ? AND tenant_id = ?').run(clientId, tenantId);
  logAudit((req as any).user.id, 'admin_delete_client', req, JSON.stringify({ client_id: clientId }), tenantId);
  res.json(message('Client deleted successfully'));
});

// POST /api/admin/clients/:clientId/rotate-secret
router.post('/clients/:clientId/rotate-secret', authenticateAdmin, validate({ params: clientIdParamsSchema }), (req, res) => {
  const { clientId } = req.params;
  const tenantId = (req as any).tenantId;
 
  const client = db.prepare('SELECT id FROM clients WHERE client_id = ? AND tenant_id = ?').get(clientId, tenantId);
  if (!client) return res.status(404).json(error('Client not found', ErrorCode.RESOURCE_NOT_FOUND));
 
  const newSecret = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE clients SET client_secret = ? WHERE client_id = ? AND tenant_id = ?').run(newSecret, clientId, tenantId);
 
  logAudit((req as any).user.id, 'admin_rotate_client_secret', req, JSON.stringify({ client_id: clientId }), tenantId);
  res.json(success({ client_secret: newSecret }, 'Secret rotated successfully'));
});

// GET /api/admin/audit
router.get('/audit', authenticateAdmin, (req, res) => {
  const { action, user_id, start_date, end_date, page = '1', pageSize = '50' } = req.query;
  const tenantId = (req as any).tenantId;

  const pageNum = Math.max(1, parseInt(page as string) || 1);
  const pageSizeNum = Math.min(200, Math.max(1, parseInt(pageSize as string) || 50));
  const offset = (pageNum - 1) * pageSizeNum;

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (action) { whereClause += ' AND a.action = ?'; params.push(action); }
  if (user_id) { whereClause += ' AND a.user_id = ?'; params.push(user_id); }
  if (start_date) { whereClause += ' AND a.created_at >= ?'; params.push(start_date); }
  if (end_date) { whereClause += ' AND a.created_at <= ?'; params.push(end_date); }

  const countQuery = `SELECT COUNT(*) as total FROM audit_logs a ${whereClause}`;
  const total = (db.prepare(countQuery).get(...params) as any).total;

  const dataQuery = `
    SELECT a.*, u.username
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `;
  const logs = db.prepare(dataQuery).all(...params, pageSizeNum, offset);

  res.json(paginated(logs, total, pageNum, pageSizeNum));
});

// GET /api/admin/audit/filter
router.get('/audit/filter', authenticateAdmin, (req, res) => {
  const { action, user_id, tenant_id, start_date, end_date, limit } = req.query;
  const limitNum = Math.min(500, Math.max(1, parseInt(limit as string) || 100));

  let query = `
    SELECT a.*, u.username, t.name as tenant_name
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN tenants t ON a.tenant_id = t.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (action) { query += ' AND a.action = ?'; params.push(action); }
  if (user_id) { query += ' AND a.user_id = ?'; params.push(user_id); }
  if (tenant_id) { query += ' AND a.tenant_id = ?'; params.push(tenant_id); }
  if (start_date) { query += ' AND a.created_at >= ?'; params.push(start_date); }
  if (end_date) { query += ' AND a.created_at <= ?'; params.push(end_date); }

  query += ' ORDER BY a.created_at DESC LIMIT ?';
  params.push(limitNum);

  res.json(success(db.prepare(query).all(...params)));
});

// GET /api/admin/audit/actions
router.get('/audit/actions', authenticateAdmin, (req, res) => {
  const actions = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all();
  res.json(success(actions.map((a: any) => a.action)));
});

// GET /api/admin/stats
router.get('/stats', authenticateAdmin, (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  const tenantCount = db.prepare('SELECT COUNT(*) as count FROM tenants').get() as any;
  const clientCount = db.prepare('SELECT COUNT(*) as count FROM clients').get() as any;
  const activeTokens = db.prepare('SELECT COUNT(*) as count FROM access_tokens WHERE revoked = 0 AND expires_at > ?').get(new Date().toISOString()) as any;
  const activeSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as any;

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentLogins = db.prepare('SELECT COUNT(*) as count FROM audit_logs WHERE action = ? AND created_at > ?').get('LOGIN_SUCCESS', yesterday) as any;
  const recentRegistrations = db.prepare('SELECT COUNT(*) as count FROM audit_logs WHERE action = ? AND created_at > ?').get('REGISTER', yesterday) as any;

  res.json(success({
    users: userCount.count,
    tenants: tenantCount.count,
    clients: clientCount.count,
    activeTokens: activeTokens.count,
    activeSessions: activeSessions.count,
    last24h: { logins: recentLogins.count, registrations: recentRegistrations.count },
  }));
});

// GET /api/admin/tenants
router.get('/tenants', authenticateAdmin, (req, res) => {
  res.json(success(db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all()));
});

// POST /api/admin/tenants
router.post('/tenants', authenticateAdmin, validate({ body: createTenantSchema }), (req, res) => {
  const { name, domain, settings } = req.body;

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO tenants (id, name, domain, settings) VALUES (?, ?, ?, ?)').run(
    id, name, domain || null, JSON.stringify(settings || {})
  );

  logAudit((req as any).user.id, 'TENANT_CREATE', req, `Created tenant: ${name}`);
  res.json(success({ id }, 'Tenant created successfully'));
});

// PUT /api/admin/tenants/:tenantId
router.put('/tenants/:tenantId', authenticateAdmin, validate({ params: tenantIdParamsSchema, body: updateTenantSchema }), (req, res) => {
  const { tenantId } = req.params;
  const { name, domain, is_active, settings } = req.body;

  db.prepare('UPDATE tenants SET name = ?, domain = ?, is_active = ?, settings = ? WHERE id = ?').run(
    name, domain, is_active ? 1 : 0, JSON.stringify(settings || {}), tenantId
  );

  logAudit((req as any).user.id, 'TENANT_UPDATE', req, `Updated tenant: ${tenantId}`);
  res.json(message('Tenant updated successfully'));
});

// DELETE /api/admin/tenants/:tenantId
router.delete('/tenants/:tenantId', authenticateAdmin, validate({ params: tenantIdParamsSchema }), (req, res) => {
  const { tenantId } = req.params;
  if (tenantId === 'default') return res.status(400).json(error('Cannot delete default tenant', ErrorCode.VALIDATION_ERROR));

  db.prepare('UPDATE users SET tenant_id = ? WHERE tenant_id = ?').run('default', tenantId);
  db.prepare('DELETE FROM tenants WHERE id = ?').run(tenantId);

  logAudit((req as any).user.id, 'TENANT_DELETE', req, `Deleted tenant: ${tenantId}`);
  res.json(message('Tenant deleted successfully'));
});

// GET /api/admin/sessions
router.get('/sessions', authenticateAdmin, (req, res) => {
  const sessions = db.prepare(`
    SELECT s.id, s.device_info, s.ip_address, s.last_active, s.created_at,
           u.username, u.email,
           (SELECT COUNT(*) FROM refresh_tokens rt WHERE rt.user_id = s.user_id AND rt.revoked = 0) as active_tokens
    FROM sessions s
    LEFT JOIN users u ON s.user_id = u.id
    ORDER BY s.last_active DESC
  `).all();
  res.json(success(sessions));
});

// DELETE /api/admin/sessions/:id
router.delete('/sessions/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) return res.status(404).json(error('Session not found', ErrorCode.RESOURCE_NOT_FOUND));

  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(session.user_id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);

  logAudit((req as any).user.id, 'ADMIN_SESSION_REVOKED', req, `Session ${id} revoked by admin`);
  res.json(message('Session revoked successfully'));
});

// POST /api/admin/maintenance/cleanup-tokens
router.post('/maintenance/cleanup-tokens', authenticateAdmin, (req, res) => {
  const result = cleanupExpiredTokens();
  res.json(success(result, 'Token cleanup completed'));
});

export default router;
