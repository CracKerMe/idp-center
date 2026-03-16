import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../database.js';
import { logAudit } from '../utils/audit.js';
import { emailService } from '../services/email.service.js';
import { cleanupExpiredTokens } from '../utils/cleanup.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/admin/users
router.get('/users', authenticateAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, email, is_active, is_admin, otp_enabled, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

// POST /api/admin/users
router.post('/users', authenticateAdmin, async (req, res) => {
  const { username, email, password, is_admin } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();

    db.prepare('INSERT INTO users (id, username, email, password_hash, is_admin, email_verified, email_verified_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(
      userId, username, email, password_hash, is_admin ? 1 : 0, new Date().toISOString()
    );

    logAudit(
      (req as any).user.id,
      'admin_create_user',
      req,
      JSON.stringify({ created_username: username, created_email: email, is_admin })
    );

    res.json({ success: true, id: userId });
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { email, is_admin, is_active } = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updates: string[] = [];
  const params: any[] = [];

  if (email !== undefined) { updates.push('email = ?'); params.push(email); }
  if (is_admin !== undefined) {
    updates.push('is_admin = ?');
    params.push(is_admin ? 1 : 0);
    if (is_admin) {
      updates.push('email_verified = 1');
      updates.push('email_verified_at = ?');
      params.push(new Date().toISOString());
    }
  }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  logAudit((req as any).user.id, 'admin_update_user', req, JSON.stringify({ target_user_id: id, updates: req.body }));
  res.json({ success: true });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id);
  logAudit((req as any).user.id, 'admin_delete_user', req, JSON.stringify({ target_user_id: id }));
  res.json({ success: true });
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id);
  db.prepare('UPDATE access_tokens SET revoked = 1 WHERE user_id = ?').run(id);
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(id);

  logAudit((req as any).user.id, 'admin_ban_user', req, JSON.stringify({ target_user_id: id }));
  res.json({ success: true });
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(id);
  logAudit((req as any).user.id, 'admin_unban_user', req, JSON.stringify({ target_user_id: id }));
  res.json({ success: true });
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', authenticateAdmin, async (req, res) => {
  const { id } = req.params;

  const user = db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare('INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(), id, resetToken, expiresAt
    );

    await emailService.sendPasswordResetEmail(user.email, resetToken, user.username);

    logAudit((req as any).user.id, 'admin_reset_password', req, JSON.stringify({ target_user_id: id }));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/clients
router.get('/clients', authenticateAdmin, (req, res) => {
  const clients = db.prepare('SELECT id, client_id, client_name, redirect_uris, grant_types, created_at FROM clients ORDER BY created_at DESC').all();
  res.json(clients);
});

// POST /api/admin/clients
router.post('/clients', authenticateAdmin, (req, res) => {
  const { client_name, redirect_uris } = req.body;
  const client_id = crypto.randomBytes(8).toString('hex');
  const client_secret = crypto.randomBytes(16).toString('hex');

  db.prepare('INSERT INTO clients (id, client_id, client_secret, client_name, redirect_uris, grant_types) VALUES (?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), client_id, client_secret, client_name, redirect_uris, 'authorization_code'
  );
  res.json({ success: true });
});

// PUT /api/admin/clients/:id
router.put('/clients/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { client_name, redirect_uris } = req.body;

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const updates: string[] = [];
  const params: any[] = [];

  if (client_name !== undefined) { updates.push('client_name = ?'); params.push(client_name); }
  if (redirect_uris !== undefined) {
    updates.push('redirect_uris = ?');
    params.push(typeof redirect_uris === 'string' ? redirect_uris : JSON.stringify(redirect_uris));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(id);
  db.prepare(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  logAudit((req as any).user.id, 'admin_update_client', req, JSON.stringify({ client_id: id }));
  res.json({ success: true });
});

// DELETE /api/admin/clients/:id
router.delete('/clients/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  logAudit((req as any).user.id, 'admin_delete_client', req, JSON.stringify({ client_id: id }));
  res.json({ success: true });
});

// POST /api/admin/clients/:id/rotate-secret
router.post('/clients/:id/rotate-secret', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const newSecret = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE clients SET client_secret = ? WHERE id = ?').run(newSecret, id);

  logAudit((req as any).user.id, 'admin_rotate_client_secret', req, JSON.stringify({ client_id: id }));
  res.json({ success: true, client_secret: newSecret });
});

// GET /api/admin/audit
router.get('/audit', authenticateAdmin, (req, res) => {
  const { action, user_id, start_date, end_date, page = '1', pageSize = '50' } = req.query;

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

  res.json({
    data: logs,
    pagination: { page: pageNum, pageSize: pageSizeNum, total, totalPages: Math.ceil(total / pageSizeNum) },
  });
});

// GET /api/admin/audit/filter
router.get('/audit/filter', authenticateAdmin, (req, res) => {
  const { action, user_id, tenant_id, start_date, end_date, limit = 100 } = req.query;

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
  params.push(parseInt(limit as string));

  res.json(db.prepare(query).all(...params));
});

// GET /api/admin/audit/actions
router.get('/audit/actions', authenticateAdmin, (req, res) => {
  const actions = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all();
  res.json(actions.map((a: any) => a.action));
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

  res.json({
    users: userCount.count,
    tenants: tenantCount.count,
    clients: clientCount.count,
    activeTokens: activeTokens.count,
    activeSessions: activeSessions.count,
    last24h: { logins: recentLogins.count, registrations: recentRegistrations.count },
  });
});

// GET /api/admin/tenants
router.get('/tenants', authenticateAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all());
});

// POST /api/admin/tenants
router.post('/tenants', authenticateAdmin, (req, res) => {
  const { name, domain, settings } = req.body;
  if (!name) return res.status(400).json({ error: 'Tenant name is required' });

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO tenants (id, name, domain, settings) VALUES (?, ?, ?, ?)').run(
    id, name, domain || null, JSON.stringify(settings || {})
  );

  logAudit((req as any).user.id, 'TENANT_CREATE', req, `Created tenant: ${name}`);
  res.json({ success: true, id });
});

// PUT /api/admin/tenants/:id
router.put('/tenants/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { name, domain, is_active, settings } = req.body;

  db.prepare('UPDATE tenants SET name = ?, domain = ?, is_active = ?, settings = ? WHERE id = ?').run(
    name, domain, is_active ? 1 : 0, JSON.stringify(settings || {}), id
  );

  logAudit((req as any).user.id, 'TENANT_UPDATE', req, `Updated tenant: ${id}`);
  res.json({ success: true });
});

// DELETE /api/admin/tenants/:id
router.delete('/tenants/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  if (id === 'default') return res.status(400).json({ error: 'Cannot delete default tenant' });

  db.prepare('UPDATE users SET tenant_id = ? WHERE tenant_id = ?').run('default', id);
  db.prepare('DELETE FROM tenants WHERE id = ?').run(id);

  logAudit((req as any).user.id, 'TENANT_DELETE', req, `Deleted tenant: ${id}`);
  res.json({ success: true });
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
  res.json(sessions);
});

// DELETE /api/admin/sessions/:id
router.delete('/sessions/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(session.user_id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);

  logAudit((req as any).user.id, 'ADMIN_SESSION_REVOKED', req, `Session ${id} revoked by admin`);
  res.json({ message: 'Session revoked successfully' });
});

// POST /api/admin/maintenance/cleanup-tokens
router.post('/maintenance/cleanup-tokens', authenticateAdmin, (req, res) => {
  res.json(cleanupExpiredTokens());
});

export default router;
