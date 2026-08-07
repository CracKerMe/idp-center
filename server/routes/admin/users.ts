import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../../database.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { emailService } from '../../services/email.service.js';
import { authenticateAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, message, paginated, ErrorCode } from '../../utils/response.js';
import { revokeAllUserTokens, RevokeReason } from '../../utils/token-blacklist.js';
import { users, refreshTokens, passwordResets } from '../../schema.js';
import { eq, or, ilike, and, desc, count } from 'drizzle-orm';
import { userIdParamsSchema, adminCreateUserSchema, adminUpdateUserSchema, listUsersQuerySchema } from '../../validators/admin.validator.js';
import { findUserInScope } from './common.js';

const router = express.Router();

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

export default router;
