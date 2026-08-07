import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../../database.js';
import { emailService } from '../../services/email.service.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { validatePasswordStrength } from '../../utils/password.js';
import { isPasswordExpired, validatePassword, recordPasswordHistory } from '../../services/password-policy.service.js';
import { authenticateToken } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, message, ErrorCode } from '../../utils/response.js';
import { users, refreshTokens, accessTokens, passwordResets } from '../../schema.js';
import { eq, and } from 'drizzle-orm';
import {
  passwordResetRequestSchema,
  passwordResetVerifySchema,
  passwordResetSchema,
  passwordValidateSchema,
  changeExpiredPasswordSchema,
} from '../../validators/auth.validator.js';

const router = express.Router();

// POST /api/auth/password/validate
router.post('/password/validate', validate({ body: passwordValidateSchema }), (req, res) => {
  const { password } = req.body;
  const result = validatePasswordStrength(password);
  res.json(success(result));
});

// POST /api/auth/password/reset-request
router.post('/password/reset-request', validate({ body: passwordResetRequestSchema }), async (req, res) => {
  const { email } = req.body;
  const tenantId = req.tenantId;

  const [user] = await db.select().from(users).where(and(eq(users.email, email), eq(users.tenantId, tenantId))).limit(1);
  if (!user) {
    return res.json(message('If the email exists, a reset link will be sent'));
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.insert(passwordResets).values({
    id: crypto.randomUUID(),
    userId: user.id,
    token,
    expiresAt,
  });

  await logAudit({ req, action: AuditAction.PASSWORD_RESET_REQUEST, userId: user.id, details: `Password reset requested for ${email}`, tenantId: tenantId });

  emailService.sendPasswordResetEmail(email, token, user.username).catch((err: any) => {
    console.error('Failed to send password reset email:', err);
  });

  res.json(message('If the email exists, a reset link will be sent'));
});

// POST /api/auth/password/reset-verify
router.post('/password/reset-verify', validate({ body: passwordResetVerifySchema }), async (req, res) => {
  const { token } = req.body;

  const [reset] = await db.select().from(passwordResets).where(and(
    eq(passwordResets.token, token),
    eq(passwordResets.used, false),
  )).limit(1);

  if (!reset) return res.status(400).json(error('Invalid or used token', ErrorCode.TOKEN_INVALID));
  if (new Date(reset.expiresAt as any) < new Date()) return res.status(400).json(error('Token expired', ErrorCode.TOKEN_EXPIRED));

  res.json(success({ valid: true }));
});

// POST /api/auth/password/reset
router.post('/password/reset', validate({ body: passwordResetSchema }), async (req, res) => {
  const { token, new_password } = req.body;

  const [reset] = await db.select().from(passwordResets).where(and(
    eq(passwordResets.token, token),
    eq(passwordResets.used, false),
  )).limit(1);

  if (!reset) return res.status(400).json(error('Invalid or used token', ErrorCode.TOKEN_INVALID));
  if (new Date(reset.expiresAt as any) < new Date()) return res.status(400).json(error('Token expired', ErrorCode.TOKEN_EXPIRED));

  const [userRow] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, reset.userId)).limit(1);
  const tenantId = userRow?.tenantId || 'default';

  const result = await validatePassword(new_password, reset.userId, tenantId);
  if (!result.valid) {
    return res.status(400).json({
      ...error('Password does not meet requirements', ErrorCode.VALIDATION_PASSWORD_WEAK),
      details: result.violations,
    });
  }

  const hash = await bcrypt.hash(new_password, 10);
  await db.update(users).set({ passwordHash: hash, passwordChangedAt: new Date() }).where(eq(users.id, reset.userId));
  await db.update(passwordResets).set({ used: true }).where(eq(passwordResets.id, reset.id));
  await recordPasswordHistory(reset.userId, hash, tenantId);

  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, reset.userId));

  await logAudit({ req, action: AuditAction.PASSWORD_RESET_COMPLETE, userId: reset.userId, details: 'Password has been reset', tenantId: tenantId });
  res.json(message('Password has been reset successfully'));
});

// POST /api/auth/password/change-expired
// Allows users with an expired password to change it without a full login session.
// No authenticateToken middleware — identity is verified via username + current password.
router.post('/password/change-expired', validate({ body: changeExpiredPasswordSchema }), async (req, res) => {
  const { username, current_password, new_password } = req.body;
  const tenantId = req.tenantId;

  try {
    // 1. Look up the user by username within the tenant
    const [user] = await db.select().from(users).where(and(
      eq(users.username, username),
      eq(users.tenantId, tenantId),
    )).limit(1);

    if (!user || !await bcrypt.compare(current_password, user.passwordHash)) {
      return res.status(401).json(error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));
    }

    // 2. Confirm password needs changing (either mustChangePassword flag or rotation expiry)
    const mustChange = user.mustChangePassword === true;
    const expiryCheck = await isPasswordExpired(user.passwordChangedAt as any, tenantId);
    if (!mustChange && !expiryCheck.expired) {
      return res.status(403).json(error('Password is not expired', ErrorCode.VALIDATION_ERROR));
    }

    // 3. Validate the new password against the tenant policy
    const validationResult = await validatePassword(new_password, user.id, tenantId);
    if (!validationResult.valid) {
      return res.status(400).json({
        ...error('Password does not meet requirements', ErrorCode.VALIDATION_PASSWORD_WEAK),
        details: validationResult.violations,
      });
    }

    // 4. Update password_hash and password_changed_at, clear mustChangePassword
    const newHash = await bcrypt.hash(new_password, 10);
    await db.update(users).set({
      passwordHash: newHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    }).where(eq(users.id, user.id));

    // 5. Record the new password in history
    await recordPasswordHistory(user.id, newHash, tenantId);

    // 6. Revoke all existing tokens for this user
    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, user.id));
    await db.update(accessTokens).set({ revoked: true }).where(eq(accessTokens.userId, user.id));

    // 7. Write audit log
    await logAudit({ req, action: AuditAction.PASSWORD_CHANGED_EXPIRED, userId: user.id, details: `Expired password changed for ${username}`, tenantId: tenantId });

    return res.json(message('Password changed successfully'));
  } catch (err: any) {
    console.error('change-expired password error:', err);
    return res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }
});

// POST /api/auth/force-change-password
// Authenticated endpoint for changing a random initial password on first login.
router.post('/force-change-password', authenticateToken, validate({ body: changeExpiredPasswordSchema }), async (req, res) => {
  const { current_password, new_password } = req.body;
  const tenantId = req.tenantId;

  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

    if (!user.mustChangePassword) {
      return res.status(403).json(error('Password change not required', ErrorCode.VALIDATION_ERROR));
    }

    if (!await bcrypt.compare(current_password, user.passwordHash)) {
      return res.status(401).json(error('Current password is incorrect', ErrorCode.AUTH_INVALID_CREDENTIALS));
    }

    if (current_password === new_password) {
      return res.status(400).json(error('New password must be different from current password', ErrorCode.VALIDATION_ERROR));
    }

    const result = await validatePassword(new_password, user.id, tenantId);
    if (!result.valid) {
      return res.status(400).json({
        ...error('Password does not meet requirements', ErrorCode.VALIDATION_PASSWORD_WEAK),
        details: result.violations,
      });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await db.update(users).set({ passwordHash: newHash, passwordChangedAt: new Date(), mustChangePassword: false }).where(eq(users.id, user.id));
    await recordPasswordHistory(user.id, newHash, tenantId);

    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, user.id));
    await db.update(accessTokens).set({ revoked: true }).where(eq(accessTokens.userId, user.id));

    await logAudit({ req, action: AuditAction.PASSWORD_FORCE_CHANGED, userId: user.id, details: `Initial password changed on first login`, tenantId: tenantId });

    return res.json(message('Password changed successfully. Please log in with your new password.'));
  } catch (err: any) {
    console.error('force-change-password error:', err);
    return res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }
});

export default router;
