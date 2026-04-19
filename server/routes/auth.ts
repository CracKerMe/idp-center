import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import jwt from 'jsonwebtoken';
import { db } from '../database.js';
import { config, SECURITY_CONFIG } from '../config.js';
import { emailService } from '../services/email.service.js';
import { logAudit } from '../utils/audit.js';
import { validatePasswordStrength } from '../utils/password.js';
import { isPasswordExpired, validatePassword, recordPasswordHistory } from '../services/password-policy.service.js';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { success, error, message, ErrorCode } from '../utils/response.js';
import { revokeToken, revokeAllUserTokens, RevokeReason } from '../utils/token-blacklist.js';
import {
  registerSchema,
  loginSchema,
  otpVerifySchema,
  emailVerifySchema,
  emailResendPublicSchema,
  passwordResetRequestSchema,
  passwordResetVerifySchema,
  passwordResetSchema,
  tokenRefreshSchema,
  passwordValidateSchema,
  changeExpiredPasswordSchema,
} from '../validators/auth.validator.js';

const router = express.Router();

function computeDeviceFingerprint(userAgent: string, ip: string): string {
  const salt = config.ENCRYPTION_KEY || config.JWT_SECRET;
  return crypto.createHmac('sha256', salt).update(userAgent + ip).digest('hex');
}

// POST /api/auth/register
router.post('/register', validate({ body: registerSchema }), (req, res) => {
  const { username, email, password } = req.body;
  const tenantId = (req as any).tenantId;

  const result = validatePassword(password, null, tenantId);
  if (!result.valid) {
    return res.status(400).json({
      ...error('Password does not meet requirements', ErrorCode.VALIDATION_PASSWORD_WEAK),
      details: result.violations,
    });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, username, email, password_hash, tenant_id) VALUES (?, ?, ?, ?, ?)').run(id, username, email, hash, tenantId);
    recordPasswordHistory(id, hash, tenantId);
    logAudit(id, 'REGISTER', req, `Registered ${username}`, tenantId);

    const verificationToken = crypto.randomUUID();
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO email_verifications (id, user_id, token, type, expires_at, used) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), id, verificationToken, 'registration', verificationExpiresAt, 0);
    emailService.sendVerificationEmail(email, verificationToken, username).catch((err: any) => {
      console.error('Failed to send verification email:', err);
    });

    res.json(message('User registered successfully'));
  } catch (err: any) {
    res.status(400).json(error('Username or email already exists', ErrorCode.RESOURCE_ALREADY_EXISTS));
  }
});

// POST /api/auth/login
router.post('/login', validate({ body: loginSchema }), (req, res) => {
  const { username, password, otp, remember_me, trust_device } = req.body;
  const tenantId = (req as any).tenantId;
  const user: any = db.prepare('SELECT * FROM users WHERE username = ? AND tenant_id = ?').get(username, tenantId);

  if (!user) {
    logAudit(null, 'LOGIN_FAILED', req, `Failed login for ${username}`, tenantId);
    return res.status(401).json(error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));
  }

  if (!user.is_active) {
    logAudit(user.id, 'LOGIN_FAILED', req, `Banned user attempted login: ${username}`);
    return res.status(403).json(error('Account is disabled', ErrorCode.ACCOUNT_DISABLED));
  }

  if (user.locked_until) {
    const lockExpiry = new Date(user.locked_until);
    if (lockExpiry > new Date()) {
      return res.status(401).json({
        ...error('Account is locked', ErrorCode.ACCOUNT_LOCKED),
        data: { unlock_at: lockExpiry.toISOString() },
      });
    }
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    const newAttempts = (user.failed_login_attempts || 0) + 1;
    if (newAttempts >= SECURITY_CONFIG.maxFailedAttempts) {
      const lockedUntil = new Date(Date.now() + SECURITY_CONFIG.lockDurationMinutes * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?').run(newAttempts, lockedUntil, user.id);
    } else {
      db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?').run(newAttempts, user.id);
    }
    logAudit(user.id, 'LOGIN_FAILED', req, `Failed login for ${username}`, tenantId);
    return res.status(401).json(error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));
  }

  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const deviceFingerprint = computeDeviceFingerprint(userAgent, ip);
  const now = new Date().toISOString();

  let deviceTrusted = false;
  if (user.otp_enabled) {
    const trustedDevice: any = db.prepare(
      'SELECT id FROM trusted_devices WHERE user_id = ? AND device_fingerprint = ? AND expires_at > ?'
    ).get(user.id, deviceFingerprint, now);

    if (trustedDevice) {
      db.prepare('UPDATE trusted_devices SET last_used_at = ? WHERE id = ?').run(now, trustedDevice.id);
      deviceTrusted = true;
    } else {
      if (!otp) {
        return res.status(403).json({
          ...error('OTP required', ErrorCode.AUTH_OTP_REQUIRED),
          data: { requireOtp: true },
        });
      }
      const isValid = authenticator.check(otp, user.otp_secret);
      if (!isValid) {
        logAudit(user.id, 'LOGIN_FAILED_OTP', req, `Failed OTP for ${username}`, tenantId);
        return res.status(401).json(error('Invalid OTP', ErrorCode.AUTH_OTP_INVALID));
      }
    }
  }

  if (!user.email_verified && !user.is_admin) {
    return res.status(403).json(error('Email not verified', ErrorCode.ACCOUNT_NOT_VERIFIED));
  }

  const pendingDeletion: any = db.prepare(
    "SELECT id FROM account_deletion_requests WHERE user_id = ? AND status = 'pending'"
  ).get(user.id);
  if (pendingDeletion) {
    return res.status(403).json(error('Account pending deletion', ErrorCode.ACCOUNT_PENDING_DELETION));
  }

  // Check password expiry before issuing tokens (Requirements 4.1, 4.4)
  const expiryCheck = isPasswordExpired(user.password_changed_at, tenantId);
  if (expiryCheck.expired) {
    return res.status(403).json({
      ...error('Password has expired', ErrorCode.PASSWORD_EXPIRED),
      data: {
        password_changed_at: user.password_changed_at,
        expires_at: expiryCheck.expiresAt,
      },
    });
  }

  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, tenant_id: user.tenant_id },
    config.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO access_tokens (id, token, client_id, user_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), accessToken, 'system', user.id, accessExpiresAt
  );

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshDays = remember_me === true ? 30 : 7;
  const refreshExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000).toISOString();

  const sessionId = crypto.randomUUID();
  db.prepare('INSERT INTO sessions (id, user_id, device_info, ip_address) VALUES (?, ?, ?, ?)').run(
    sessionId, user.id, userAgent, ip
  );

  let newDeviceTrusted = false;
  let deviceId: string | null = null;
  if (trust_device === true) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const deviceName = userAgent.substring(0, 100);
    deviceId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO trusted_devices (id, user_id, device_fingerprint, device_name, expires_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, device_fingerprint) DO UPDATE SET
        expires_at = excluded.expires_at,
        last_used_at = excluded.last_used_at,
        device_name = excluded.device_name
    `).run(deviceId, user.id, deviceFingerprint, deviceName, expiresAt, now);
    newDeviceTrusted = true;
  }

  db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at, remember_me, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), refreshToken, user.id, null, refreshExpiresAt, remember_me === true ? 1 : 0, deviceId
  );

  logAudit(user.id, 'LOGIN_SUCCESS', req, `Session: ${sessionId}`, tenantId);

  res.json(success({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 900,
    token_type: 'Bearer',
    device_trusted: newDeviceTrusted || deviceTrusted,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      otp_enabled: user.otp_enabled,
      tenant_id: user.tenant_id,
    },
    session_id: sessionId,
  }, 'Login successful'));
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const user: any = db.prepare('SELECT id, username, email, full_name, phone, avatar_url, is_admin, otp_enabled, tenant_id FROM users WHERE id = ?').get((req as any).user.id);
  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));
  res.json(success(user));
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const sessionId = req.headers['x-session-id'];
  const currentToken = (req as any).token;

  try {
    if (sessionId) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND device_id IN (SELECT id FROM trusted_devices WHERE user_id = ?)').run(userId, userId);
      db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
    } else {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
    }

    if (currentToken) {
      revokeToken(currentToken, RevokeReason.LOGOUT);
    }
    const tenantId = (req as any).tenantId || (req as any).user?.tenant_id || 'default';
    logAudit(userId, 'LOGOUT', req, sessionId ? `Session: ${sessionId}` : 'All sessions', tenantId);
    res.json(message('Logged out successfully'));
  } catch (err: any) {
    console.error('Logout error:', err);
    res.status(500).json(error('Failed to logout', ErrorCode.SERVER_ERROR));
  }
});

// POST /api/auth/otp/setup
router.post('/otp/setup', authenticateToken, async (req, res) => {
  const userId = (req as any).user.id;
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (user.otp_enabled) {
    return res.status(400).json(error('OTP is already enabled. Disable it first to reconfigure.', ErrorCode.VALIDATION_FAILED));
  }

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user.username, 'IdP Center', secret);
  db.prepare('UPDATE users SET otp_secret = ? WHERE id = ?').run(secret, userId);

  const qrCodeUrl = await qrcode.toDataURL(otpauth);
  res.json(success({ secret, qrCodeUrl }));
});

// POST /api/auth/otp/verify
router.post('/otp/verify', authenticateToken, validate({ body: otpVerifySchema }), (req, res) => {
  const { token } = req.body;
  const userId = (req as any).user.id;
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  const isValid = authenticator.check(token, user.otp_secret);
  if (isValid) {
    db.prepare('UPDATE users SET otp_enabled = 1 WHERE id = ?').run(userId);
    const tenantId = (req as any).tenantId || user.tenant_id;
    logAudit(userId, 'OTP_ENABLED', req, '', tenantId);
    res.json(success({ enabled: true }, 'OTP enabled successfully'));
  } else {
    res.status(400).json(error('Invalid OTP', ErrorCode.AUTH_OTP_INVALID));
  }
});

// POST /api/auth/password/validate
router.post('/password/validate', validate({ body: passwordValidateSchema }), (req, res) => {
  const { password } = req.body;
  const result = validatePasswordStrength(password);
  res.json(success(result));
});

// POST /api/auth/email/verify
router.post('/email/verify', validate({ body: emailVerifySchema }), (req, res) => {
  const { token } = req.body;

  const now = new Date().toISOString();
  const record: any = db.prepare(
    'SELECT * FROM email_verifications WHERE token = ? AND used = 0 AND expires_at > ?'
  ).get(token, now);

  if (!record) {
    const anyRecord: any = db.prepare('SELECT * FROM email_verifications WHERE token = ?').get(token);
    if (anyRecord && anyRecord.used) {
      return res.status(400).json(error('Token already used', ErrorCode.TOKEN_ALREADY_USED));
    }
    return res.status(400).json(error('Token expired or invalid', ErrorCode.TOKEN_EXPIRED));
  }

  db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(record.id);
  db.prepare('UPDATE users SET email_verified = 1, email_verified_at = ? WHERE id = ?').run(now, record.user_id);

  logAudit(record.user_id, 'EMAIL_VERIFIED', req, 'Email verified successfully');
  res.json(message('Email verified successfully'));
});

// POST /api/auth/email/resend (authenticated)
router.post('/email/resend', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));
  if (user.email_verified) return res.status(400).json(error('Email is already verified', ErrorCode.VALIDATION_ERROR));

  const verificationToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO email_verifications (id, user_id, token, type, expires_at, used) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, verificationToken, 'registration', expiresAt, 0);

  emailService.sendVerificationEmail(user.email, verificationToken, user.username).catch((err: any) => {
    console.error('Failed to send verification email:', err);
  });

  const tenantId = (req as any).tenantId || user.tenant_id;
  logAudit(userId, 'EMAIL_VERIFICATION_RESENT', req, 'Verification email resent', tenantId);
  res.json(message('Verification email sent'));
});

// POST /api/auth/email/resend-public (public, no auth)
router.post('/email/resend-public', validate({ body: emailResendPublicSchema }), (req, res) => {
  const { email, username } = req.body;
  const tenantId = (req as any).tenantId;
  const user: any = email
    ? db.prepare('SELECT * FROM users WHERE email = ? AND tenant_id = ?').get(email, tenantId)
    : db.prepare('SELECT * FROM users WHERE username = ? AND tenant_id = ?').get(username, tenantId);

  if (!user || user.email_verified) {
    return res.json(message('If the account exists and is unverified, a verification link will be sent'));
  }

  const verificationToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO email_verifications (id, user_id, token, type, expires_at, used) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), user.id, verificationToken, 'registration', expiresAt, 0);

  emailService.sendVerificationEmail(user.email, verificationToken, user.username).catch((err: any) => {
    console.error('Failed to send verification email:', err);
  });

  logAudit(user.id, 'EMAIL_VERIFICATION_RESENT', req, 'Verification email resent (public)', tenantId);
  res.json(message('If the email exists and is unverified, a verification link will be sent'));
});

// POST /api/auth/password/reset-request
router.post('/password/reset-request', validate({ body: passwordResetRequestSchema }), (req, res) => {
  const { email } = req.body;
  const tenantId = (req as any).tenantId;
 
  const user: any = db.prepare('SELECT * FROM users WHERE email = ? AND tenant_id = ?').get(email, tenantId);
  if (!user) {
    return res.json(message('If the email exists, a reset link will be sent'));
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(
    crypto.randomUUID(), user.id, token, expiresAt
  );
 
  logAudit(user.id, 'PASSWORD_RESET_REQUEST', req, `Password reset requested for ${email}`, tenantId);
 
  emailService.sendPasswordResetEmail(email, token, user.username).catch((err: any) => {
    console.error('Failed to send password reset email:', err);
  });

  res.json(message('If the email exists, a reset link will be sent'));
});

// POST /api/auth/password/reset-verify
router.post('/password/reset-verify', validate({ body: passwordResetVerifySchema }), (req, res) => {
  const { token } = req.body;

  const reset: any = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(token);
  if (!reset) return res.status(400).json(error('Invalid or used token', ErrorCode.TOKEN_INVALID));
  if (new Date(reset.expires_at) < new Date()) return res.status(400).json(error('Token expired', ErrorCode.TOKEN_EXPIRED));

  res.json(success({ valid: true }));
});

// POST /api/auth/password/reset
router.post('/password/reset', validate({ body: passwordResetSchema }), (req, res) => {
  const { token, new_password } = req.body;

  const reset: any = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(token);
  if (!reset) return res.status(400).json(error('Invalid or used token', ErrorCode.TOKEN_INVALID));
  if (new Date(reset.expires_at) < new Date()) return res.status(400).json(error('Token expired', ErrorCode.TOKEN_EXPIRED));

  const user: any = db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(reset.user_id);
  const tenantId = user?.tenant_id || 'default';

  const result = validatePassword(new_password, reset.user_id, tenantId);
  if (!result.valid) {
    return res.status(400).json({
      ...error('Password does not meet requirements', ErrorCode.VALIDATION_PASSWORD_WEAK),
      details: result.violations,
    });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(hash, new Date().toISOString(), reset.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
  recordPasswordHistory(reset.user_id, hash, tenantId);

  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(reset.user_id);

  logAudit(reset.user_id, 'PASSWORD_RESET_COMPLETE', req, 'Password has been reset', tenantId);
  res.json(message('Password has been reset successfully'));
});

// POST /api/auth/refresh
router.post('/refresh', validate({ body: tokenRefreshSchema }), (req, res) => {
  const { refresh_token } = req.body;

  const storedToken: any = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0').get(refresh_token);
  if (!storedToken) return res.status(401).json(error('Invalid refresh token', ErrorCode.TOKEN_INVALID));

  const user: any = db.prepare('SELECT * FROM users WHERE id = ?').get(storedToken.user_id);
  if (!user || !user.is_active) return res.status(401).json(error('User not found or inactive', ErrorCode.ACCOUNT_DISABLED));

  // Sign new access token
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin, tenant_id: user.tenant_id },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN as any }
  );
  const accessExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

  // Rotate refresh token
  const refreshDays = storedToken.remember_me === 1 ? 30 : 7;
  const newExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000).toISOString();
  const newRefreshToken = crypto.randomBytes(32).toString('hex');

  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(storedToken.id);
  db.prepare('INSERT INTO refresh_tokens (id, token, user_id, client_id, expires_at, remember_me) VALUES (?, ?, ?, ?, ?, ?)').run(
    crypto.randomUUID(), newRefreshToken, user.id, storedToken.client_id, newExpiresAt, storedToken.remember_me || 0
  );

  logAudit(user.id, 'TOKEN_REFRESH', req, '', user.tenant_id);

  res.json(success({
    access_token: accessToken,
    refresh_token: newRefreshToken,
    expires_at: accessExpiresAt
  }));
});

// POST /api/auth/password/change-expired
// Allows users with an expired password to change it without a full login session.
// No authenticateToken middleware — identity is verified via username + current password.
router.post('/password/change-expired', validate({ body: changeExpiredPasswordSchema }), (req, res) => {
  const { username, current_password, new_password } = req.body;
  const tenantId = (req as any).tenantId;

  try {
    // 1. Look up the user by username within the tenant
    const user: any = db.prepare(
      'SELECT * FROM users WHERE username = ? AND tenant_id = ?'
    ).get(username, tenantId);

    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json(error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));
    }

    // 2. Confirm tenant has rotation enabled and password is actually expired
    const expiryCheck = isPasswordExpired(user.password_changed_at, tenantId);
    if (!expiryCheck.expired) {
      return res.status(403).json(error('Password is not expired', ErrorCode.VALIDATION_ERROR));
    }

    // 3. Validate the new password against the tenant policy
    const validationResult = validatePassword(new_password, user.id, tenantId);
    if (!validationResult.valid) {
      return res.status(400).json({
        ...error('Password does not meet requirements', ErrorCode.VALIDATION_PASSWORD_WEAK),
        details: validationResult.violations,
      });
    }

    // 4. Update password_hash and password_changed_at
    const newHash = bcrypt.hashSync(new_password, 10);
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?'
    ).run(newHash, now, user.id);

    // 5. Record the new password in history
    recordPasswordHistory(user.id, newHash, tenantId);

    // 6. Write audit log
    logAudit(user.id, 'PASSWORD_CHANGED_EXPIRED', req, `Expired password changed for ${username}`, tenantId);

    return res.json(message('Password changed successfully'));
  } catch (err: any) {
    console.error('change-expired password error:', err);
    return res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }
});

export default router;
