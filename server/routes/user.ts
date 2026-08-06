import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import { db } from '../database.js';
import { config, rootDir } from '../config.js';
import { logAudit } from '../utils/audit.js';
import { validatePassword, recordPasswordHistory } from '../services/password-policy.service.js';
import { emailService } from '../services/email.service.js';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { success, error, message, ErrorCode } from '../utils/response.js';
import { revokeOtherUserTokens, RevokeReason } from '../utils/token-blacklist.js';
import {
  updateProfileSchema,
  changePasswordSchema,
  deleteAccountSchema,
  sessionIdParamsSchema,
  deviceIdParamsSchema,
} from '../validators/user.validator.js';
import {
  users,
  accessTokens,
  refreshTokens,
  sessions,
  trustedDevices,
  linkedAccounts,
  accountDeletionRequests,
} from '../schema.js';
import { eq, and, gt, desc, sql } from 'drizzle-orm';

const router = express.Router();

// --- Avatar upload configuration ---
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(rootDir, 'uploads', 'avatars'));
  },
  filename: (req, file, cb) => {
    const userId = req.user?.id;
    const ext = file.mimetype === 'image/jpeg' ? 'jpg'
      : file.mimetype === 'image/png' ? 'png'
      : 'webp';
    cb(null, `${userId}.${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
});

// --- GDPR account deletion helper ---
async function executeAccountDeletion(userId: string) {
  const anonymousId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.update(users).set({
      email: `deleted_${anonymousId}@deleted`,
      username: `deleted_${anonymousId}`,
      passwordHash: '',
      fullName: null,
      phone: null,
      avatarUrl: null,
      isActive: false,
    }).where(eq(users.id, userId));

    await tx.update(accessTokens).set({ revoked: true }).where(eq(accessTokens.userId, userId));
    await tx.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId));
    await tx.delete(linkedAccounts).where(eq(linkedAccounts.userId, userId));

    await tx.update(accountDeletionRequests).set({
      status: 'completed',
      completedAt: new Date(),
    }).where(and(eq(accountDeletionRequests.userId, userId), eq(accountDeletionRequests.status, 'pending')));
  });
}

// PUT /api/user/profile
router.put('/profile', authenticateToken, validate({ body: updateProfileSchema }), async (req, res) => {
  const userId = req.user!.id;
  const { full_name, phone } = req.body;

  await db.update(users).set({
    fullName: full_name || null,
    phone: phone || null,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  await logAudit(userId, 'PROFILE_UPDATE', req, `Updated profile: full_name=${full_name}, phone=${phone}`);
  res.json(message('Profile updated successfully'));
});

// PUT /api/user/password
router.put('/password', authenticateToken, validate({ body: changePasswordSchema }), async (req, res) => {
  const userId = req.user!.id;
  const { current_password, new_password } = req.body;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));
  }

  if (!await bcrypt.compare(current_password, user.passwordHash)) {
    await logAudit(userId, 'PASSWORD_CHANGE_FAILED', req, 'Incorrect current password');
    return res.status(401).json(error('Current password is incorrect', ErrorCode.AUTH_INVALID_CREDENTIALS));
  }

  const result = await validatePassword(new_password, userId, user.tenantId ?? 'default');
  if (!result.valid) {
    return res.status(400).json({
      ...error('New password does not meet requirements', ErrorCode.VALIDATION_PASSWORD_WEAK),
      details: result.violations,
    });
  }

  const hash = await bcrypt.hash(new_password, 10);
  await db.update(users).set({
    passwordHash: hash,
    passwordChangedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  await recordPasswordHistory(userId, hash, user.tenantId ?? 'default');

  const currentAccessToken = req.token;

  if (currentAccessToken) {
    await revokeOtherUserTokens(userId, currentAccessToken, RevokeReason.PASSWORD_CHANGE);
  } else {
    await db.update(accessTokens).set({ revoked: true }).where(eq(accessTokens.userId, userId));
  }
  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId));

  await logAudit(userId, 'PASSWORD_CHANGE_SUCCESS', req, 'Password changed successfully');
  res.json(message('Password changed successfully'));
});

// GET /api/user/sessions
router.get('/sessions', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const sessionList = await db.execute(sql`
    SELECT s.id, s.device_info, s.ip_address, s.last_active, s.created_at,
      (SELECT COUNT(*)::int FROM refresh_tokens rt WHERE rt.user_id = s.user_id AND rt.revoked = false) as active_tokens
    FROM sessions s
    WHERE s.user_id = ${userId}
    ORDER BY s.last_active DESC
  `);
  res.json(success(sessionList));
});

// DELETE /api/user/sessions/:id
router.delete('/sessions/:sessionId', authenticateToken, validate({ params: sessionIdParamsSchema }), async (req, res) => {
  const userId = req.user!.id;
  const { sessionId } = req.params;
  const currentSessionId = req.headers['x-session-id'];

  if (currentSessionId && sessionId === currentSessionId) {
    return res.status(400).json(error('Cannot revoke current session. Use logout instead.', ErrorCode.VALIDATION_ERROR));
  }

  const [session] = await db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId))).limit(1);
  if (!session) return res.status(404).json(error('Session not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await logAudit(userId, 'SESSION_REVOKED', req, `Session ${sessionId} revoked remotely`);
  res.json(message('Session revoked successfully'));
});

// GET /api/user/trusted-devices
router.get('/trusted-devices', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const now = new Date();
  const devices = await db.select({
    id: trustedDevices.id,
    deviceName: trustedDevices.deviceName,
    trustedAt: trustedDevices.trustedAt,
    expiresAt: trustedDevices.expiresAt,
    lastUsedAt: trustedDevices.lastUsedAt,
  }).from(trustedDevices).where(and(eq(trustedDevices.userId, userId), gt(trustedDevices.expiresAt, now))).orderBy(desc(trustedDevices.trustedAt));
  res.json(success(devices));
});

// DELETE /api/user/trusted-devices/:deviceId
router.delete('/trusted-devices/:deviceId', authenticateToken, validate({ params: deviceIdParamsSchema }), async (req, res) => {
  const userId = req.user!.id;
  const { deviceId } = req.params;

  const [device] = await db.select({ id: trustedDevices.id }).from(trustedDevices).where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, userId))).limit(1);
  if (!device) return res.status(404).json(error('Device not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.delete(trustedDevices).where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, userId)));
  await logAudit(userId, 'TRUSTED_DEVICE_REVOKED', req, `Trusted device ${deviceId} revoked`);
  res.json(message('Trusted device removed successfully'));
});

// GET /api/user/linked-accounts
router.get('/linked-accounts', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const accounts = await db.select({
    provider: linkedAccounts.provider,
    providerUsername: linkedAccounts.providerUsername,
    createdAt: linkedAccounts.createdAt,
  }).from(linkedAccounts).where(eq(linkedAccounts.userId, userId));
  res.json(success(accounts));
});

// POST /api/user/account/delete-request
router.post('/account/delete-request', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));

  const [existing] = await db.select().from(accountDeletionRequests).where(and(eq(accountDeletionRequests.userId, userId), eq(accountDeletionRequests.status, 'pending'))).limit(1);
  if (existing) return res.status(400).json(error('Deletion request already exists', ErrorCode.RESOURCE_ALREADY_EXISTS));

  const id = crypto.randomUUID();
  const requestedAt = new Date();
  const scheduledDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(accountDeletionRequests).values({
    id,
    userId,
    requestedAt,
    scheduledDeleteAt,
    status: 'pending',
  });

  emailService.sendAccountDeletionConfirmEmail(user.email, user.username, scheduledDeleteAt.toISOString()).catch((err: any) => {
    console.error('Failed to send account deletion confirmation email:', err);
  });

  await logAudit(userId, 'ACCOUNT_DELETION_REQUESTED', req, `Scheduled for ${scheduledDeleteAt.toISOString()}`);
  res.json(success({
    scheduled_delete_at: scheduledDeleteAt.toISOString(),
    request: { id, user_id: userId, status: 'pending', requested_at: requestedAt.toISOString(), scheduled_delete_at: scheduledDeleteAt.toISOString() },
  }, 'Account deletion request created'));
});

// DELETE /api/user/account/delete-request
router.delete('/account/delete-request', authenticateToken, async (req, res) => {
  const userId = req.user!.id;

  const [pending] = await db.select().from(accountDeletionRequests).where(and(eq(accountDeletionRequests.userId, userId), eq(accountDeletionRequests.status, 'pending'))).limit(1);
  if (!pending) return res.status(404).json(error('No pending deletion request found', ErrorCode.RESOURCE_NOT_FOUND));

  const cancelledAt = new Date();
  await db.update(accountDeletionRequests).set({
    status: 'cancelled',
    cancelledAt,
  }).where(eq(accountDeletionRequests.id, pending.id));

  await logAudit(userId, 'ACCOUNT_DELETION_CANCELLED', req, `Request ${pending.id} cancelled`);
  res.json(message('Account deletion request cancelled'));
});

// GET /api/user/account/delete-request
router.get('/account/delete-request', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const [request] = await db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, userId)).orderBy(desc(accountDeletionRequests.requestedAt)).limit(1);
  res.json(success({ request: request || null }));
});

// POST /api/user/avatar
router.post('/avatar', authenticateToken, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json(error('Only jpg, png, and webp images are allowed', ErrorCode.VALIDATION_ERROR));
      }
      if ((err as any).code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json(error('File size must not exceed 2MB', ErrorCode.VALIDATION_ERROR));
      }
      return res.status(400).json(error(err.message, ErrorCode.VALIDATION_ERROR));
    }

    if (!req.file) return res.status(400).json(error('No file uploaded', ErrorCode.VALIDATION_REQUIRED));

    const userId = req.user!.id;
    const ext = req.file.mimetype === 'image/jpeg' ? 'jpg'
      : req.file.mimetype === 'image/png' ? 'png'
      : 'webp';
    const avatarUrl = `/api/uploads/avatars/${userId}.${ext}`;

    db.update(users).set({
      avatarUrl,
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).then(() => {
      logAudit(userId, 'AVATAR_UPLOADED', req, `Avatar updated: ${avatarUrl}`);
      res.json(success({ avatar_url: avatarUrl }));
    });
  });
});

// PUT /api/user/avatar/url
router.put('/avatar/url', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const { url } = req.body;

  if (!url || typeof url !== 'string') return res.status(400).json(error('URL is required', ErrorCode.VALIDATION_REQUIRED));

  await db.update(users).set({
    avatarUrl: url,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  await logAudit(userId, 'AVATAR_URL_SET', req, `Avatar URL set to external URL`);
  res.json(success({ avatar_url: url }));
});

// DELETE /api/user/avatar
router.delete('/avatar', authenticateToken, async (req, res) => {
  const userId = req.user!.id;

  await db.update(users).set({
    avatarUrl: null,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  await logAudit(userId, 'AVATAR_DELETED', req, 'Avatar cleared');
  res.json(message('Avatar deleted successfully'));
});

export { executeAccountDeletion };
export default router;
