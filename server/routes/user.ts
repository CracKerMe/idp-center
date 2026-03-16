import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import { db } from '../database.js';
import { config, rootDir } from '../config.js';
import { logAudit } from '../utils/audit.js';
import { validatePasswordStrength } from '../utils/password.js';
import { emailService } from '../services/email.service.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// --- Avatar upload configuration ---
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(rootDir, 'uploads', 'avatars'));
  },
  filename: (req, file, cb) => {
    const userId = (req as any).user?.id;
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
function executeAccountDeletion(userId: string) {
  const anonymousId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    'UPDATE users SET email = ?, username = ?, password_hash = ?, full_name = NULL, phone = NULL, avatar_url = NULL, is_active = 0 WHERE id = ?'
  ).run(`deleted_${anonymousId}@deleted`, `deleted_${anonymousId}`, '', userId);

  db.prepare('UPDATE access_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM linked_accounts WHERE user_id = ?').run(userId);

  db.prepare(
    "UPDATE account_deletion_requests SET status = 'completed', completed_at = ? WHERE user_id = ? AND status = 'pending'"
  ).run(now, userId);
}

// PUT /api/user/profile
router.put('/profile', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const { full_name, phone } = req.body;

  db.prepare('UPDATE users SET full_name = ?, phone = ?, updated_at = ? WHERE id = ?').run(
    full_name || null, phone || null, new Date().toISOString(), userId
  );

  logAudit(userId, 'PROFILE_UPDATE', req, `Updated profile: full_name=${full_name}, phone=${phone}`);
  res.json({ message: 'Profile updated successfully' });
});

// PUT /api/user/password
router.put('/password', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }

  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    logAudit(userId, 'PASSWORD_CHANGE_FAILED', req, 'Incorrect current password');
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const strength = validatePasswordStrength(new_password);
  if (!strength.valid) {
    return res.status(400).json({ error: 'New password does not meet requirements', details: strength.errors });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?').run(
    hash, new Date().toISOString(), new Date().toISOString(), userId
  );

  const authHeader = req.headers['authorization'];
  const currentAccessToken = authHeader && authHeader.split(' ')[1];

  if (currentAccessToken) {
    db.prepare('UPDATE access_tokens SET revoked = 1 WHERE user_id = ? AND token != ?').run(userId, currentAccessToken);
  } else {
    db.prepare('UPDATE access_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
  }
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);

  logAudit(userId, 'PASSWORD_CHANGE_SUCCESS', req, 'Password changed successfully');
  res.json({ message: 'Password changed successfully' });
});

// GET /api/user/sessions
router.get('/sessions', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const sessions = db.prepare(`
    SELECT s.id, s.device_info, s.ip_address, s.last_active, s.created_at,
           (SELECT COUNT(*) FROM refresh_tokens rt WHERE rt.user_id = s.user_id AND rt.revoked = 0) as active_tokens
    FROM sessions s
    WHERE s.user_id = ?
    ORDER BY s.last_active DESC
  `).all(userId);
  res.json(sessions);
});

// DELETE /api/user/sessions/:id
router.delete('/sessions/:id', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const currentSessionId = req.headers['x-session-id'];

  if (currentSessionId && id === currentSessionId) {
    return res.status(400).json({ error: 'Cannot revoke current session. Use logout instead.' });
  }

  const session: any = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, userId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  logAudit(userId, 'SESSION_REVOKED', req, `Session ${id} revoked remotely`);
  res.json({ message: 'Session revoked successfully' });
});

// GET /api/user/trusted-devices
router.get('/trusted-devices', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const now = new Date().toISOString();
  const devices = db.prepare(
    'SELECT id, device_name, trusted_at, expires_at, last_used_at FROM trusted_devices WHERE user_id = ? AND expires_at > ? ORDER BY trusted_at DESC'
  ).all(userId, now);
  res.json(devices);
});

// DELETE /api/user/trusted-devices/:id
router.delete('/trusted-devices/:id', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const { id } = req.params;

  const device: any = db.prepare('SELECT id FROM trusted_devices WHERE id = ? AND user_id = ?').get(id, userId);
  if (!device) return res.status(404).json({ error: 'DEVICE_NOT_FOUND' });

  db.prepare('DELETE FROM trusted_devices WHERE id = ? AND user_id = ?').run(id, userId);
  logAudit(userId, 'TRUSTED_DEVICE_REVOKED', req, `Trusted device ${id} revoked`);
  res.json({ message: 'Trusted device removed successfully' });
});

// GET /api/user/linked-accounts
router.get('/linked-accounts', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const accounts = db.prepare(
    'SELECT provider, provider_username, created_at FROM linked_accounts WHERE user_id = ?'
  ).all(userId);
  res.json(accounts);
});

// POST /api/user/account/delete-request
router.post('/account/delete-request', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const existing: any = db.prepare(
    "SELECT * FROM account_deletion_requests WHERE user_id = ? AND status = 'pending'"
  ).get(userId);
  if (existing) return res.status(400).json({ error: 'DELETION_REQUEST_EXISTS' });

  const id = crypto.randomUUID();
  const requestedAt = new Date().toISOString();
  const scheduledDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    "INSERT INTO account_deletion_requests (id, user_id, requested_at, scheduled_delete_at, status) VALUES (?, ?, ?, ?, 'pending')"
  ).run(id, userId, requestedAt, scheduledDeleteAt);

  emailService.sendAccountDeletionConfirmEmail(user.email, user.username, scheduledDeleteAt).catch((err: any) => {
    console.error('Failed to send account deletion confirmation email:', err);
  });

  logAudit(userId, 'ACCOUNT_DELETION_REQUESTED', req, `Scheduled for ${scheduledDeleteAt}`);
  res.json({
    message: 'Account deletion request created',
    scheduled_delete_at: scheduledDeleteAt,
    request: { id, user_id: userId, status: 'pending', requested_at: requestedAt, scheduled_delete_at: scheduledDeleteAt },
  });
});

// DELETE /api/user/account/delete-request
router.delete('/account/delete-request', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;

  const pending: any = db.prepare(
    "SELECT * FROM account_deletion_requests WHERE user_id = ? AND status = 'pending'"
  ).get(userId);
  if (!pending) return res.status(404).json({ error: 'NO_PENDING_REQUEST' });

  const cancelledAt = new Date().toISOString();
  db.prepare(
    "UPDATE account_deletion_requests SET status = 'cancelled', cancelled_at = ? WHERE id = ?"
  ).run(cancelledAt, pending.id);

  logAudit(userId, 'ACCOUNT_DELETION_CANCELLED', req, `Request ${pending.id} cancelled`);
  res.json({ message: 'Account deletion request cancelled' });
});

// GET /api/user/account/delete-request
router.get('/account/delete-request', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const request: any = db.prepare(
    'SELECT * FROM account_deletion_requests WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1'
  ).get(userId);
  res.json({ request: request || null });
});

// POST /api/user/avatar
router.post('/avatar', authenticateToken, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ error: 'INVALID_FILE_TYPE', message: 'Only jpg, png, and webp images are allowed' });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'File size must not exceed 2MB' });
      }
      return res.status(400).json({ error: 'UPLOAD_ERROR', message: err.message });
    }

    if (!req.file) return res.status(400).json({ error: 'NO_FILE', message: 'No file uploaded' });

    const userId = (req as any).user.id;
    const ext = req.file.mimetype === 'image/jpeg' ? 'jpg'
      : req.file.mimetype === 'image/png' ? 'png'
      : 'webp';
    const avatarUrl = `/api/uploads/avatars/${userId}.${ext}`;

    db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?').run(
      avatarUrl, new Date().toISOString(), userId
    );

    logAudit(userId, 'AVATAR_UPLOADED', req, `Avatar updated: ${avatarUrl}`);
    res.json({ avatar_url: avatarUrl });
  });
});

// PUT /api/user/avatar/url
router.put('/avatar/url', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const { url } = req.body;

  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL is required' });

  db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?').run(
    url, new Date().toISOString(), userId
  );

  logAudit(userId, 'AVATAR_URL_SET', req, `Avatar URL set to external URL`);
  res.json({ avatar_url: url });
});

// DELETE /api/user/avatar
router.delete('/avatar', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;

  db.prepare('UPDATE users SET avatar_url = NULL, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(), userId
  );

  logAudit(userId, 'AVATAR_DELETED', req, 'Avatar cleared');
  res.json({ message: 'Avatar deleted successfully' });
});

export { executeAccountDeletion };
export default router;
