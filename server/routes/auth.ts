import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import jwt from 'jsonwebtoken';
import { db } from '../database.js';
import { config, SECURITY_CONFIG, TOKEN_CONFIG } from '../config.js';
import { emailService } from '../services/email.service.js';
import { logAudit } from '../utils/audit.js';
import { validatePasswordStrength } from '../utils/password.js';
import { isPasswordExpired, validatePassword, recordPasswordHistory } from '../services/password-policy.service.js';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { success, error, message, ErrorCode } from '../utils/response.js';
import { revokeToken, revokeAllUserTokens, RevokeReason } from '../utils/token-blacklist.js';
import { users, accessTokens, refreshTokens, sessions, emailVerifications, passwordResets, trustedDevices, accountDeletionRequests } from '../schema.js';
import { eq, and, gt, inArray } from 'drizzle-orm';
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
router.post('/register', validate({ body: registerSchema }), async (req, res) => {
  const { username, email, password } = req.body;
  const tenantId = req.tenantId;

  const result = await validatePassword(password, null, tenantId);
  if (!result.valid) {
    return res.status(400).json({
      ...error('Password does not meet requirements', ErrorCode.VALIDATION_PASSWORD_WEAK),
      details: result.violations,
    });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      username,
      email,
      passwordHash: hash,
      tenantId,
    });
    await recordPasswordHistory(id, hash, tenantId);
    await logAudit(id, 'REGISTER', req, `Registered ${username}`, tenantId);

    const verificationToken = crypto.randomUUID();
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(emailVerifications).values({
      id: crypto.randomUUID(),
      userId: id,
      token: verificationToken,
      type: 'registration',
      expiresAt: verificationExpiresAt,
      used: false,
    });
    emailService.sendVerificationEmail(email, verificationToken, username).catch((err: any) => {
      console.error('Failed to send verification email:', err);
    });

    res.json(message('User registered successfully'));
  } catch (err: any) {
    res.status(400).json(error('Username or email already exists', ErrorCode.RESOURCE_ALREADY_EXISTS));
  }
});

// POST /api/auth/login
router.post('/login', validate({ body: loginSchema }), async (req, res) => {
  const { username, password, otp, remember_me, trust_device } = req.body;
  const tenantId = req.tenantId;

  const [user] = await db.select().from(users).where(and(eq(users.username, username), eq(users.tenantId, tenantId))).limit(1);

  if (!user) {
    await logAudit(null, 'LOGIN_FAILED', req, `Failed login for ${username}`, tenantId);
    return res.status(401).json(error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));
  }

  if (!user.isActive) {
    await logAudit(user.id, 'LOGIN_FAILED', req, `Banned user attempted login: ${username}`);
    return res.status(403).json(error('Account is disabled', ErrorCode.ACCOUNT_DISABLED));
  }

  if (user.lockedUntil) {
    const lockExpiry = new Date(user.lockedUntil);
    if (lockExpiry > new Date()) {
      return res.status(401).json({
        ...error('Account is locked', ErrorCode.ACCOUNT_LOCKED),
        data: { unlock_at: lockExpiry.toISOString() },
      });
    }
  }

  if (!await bcrypt.compare(password, user.passwordHash)) {
    const newAttempts = (user.failedLoginAttempts || 0) + 1;
    if (newAttempts >= SECURITY_CONFIG.maxFailedAttempts) {
      const lockedUntil = new Date(Date.now() + SECURITY_CONFIG.lockDurationMinutes * 60 * 1000);
      await db.update(users).set({ failedLoginAttempts: newAttempts, lockedUntil }).where(eq(users.id, user.id));
    } else {
      await db.update(users).set({ failedLoginAttempts: newAttempts }).where(eq(users.id, user.id));
    }
    await logAudit(user.id, 'LOGIN_FAILED', req, `Failed login for ${username}`, tenantId);
    return res.status(401).json(error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));
  }

  await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));

  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const deviceFingerprint = computeDeviceFingerprint(userAgent, ip);
  const now = new Date();

  let deviceTrusted = false;
  if (user.otpEnabled) {
    const [trustedDevice] = await db.select({ id: trustedDevices.id }).from(trustedDevices).where(and(
      eq(trustedDevices.userId, user.id),
      eq(trustedDevices.deviceFingerprint, deviceFingerprint),
      gt(trustedDevices.expiresAt, now),
    )).limit(1);

    if (trustedDevice) {
      await db.update(trustedDevices).set({ lastUsedAt: now }).where(eq(trustedDevices.id, trustedDevice.id));
      deviceTrusted = true;
    } else {
      if (!otp) {
        return res.status(403).json({
          ...error('OTP required', ErrorCode.AUTH_OTP_REQUIRED),
          data: { requireOtp: true },
        });
      }
      const isValid = authenticator.check(otp, user.otpSecret!);
      if (!isValid) {
        await logAudit(user.id, 'LOGIN_FAILED_OTP', req, `Failed OTP for ${username}`, tenantId);
        return res.status(401).json(error('Invalid OTP', ErrorCode.AUTH_OTP_INVALID));
      }
    }
  }

  if (!user.emailVerified && !user.isAdmin) {
    return res.status(403).json(error('Email not verified', ErrorCode.ACCOUNT_NOT_VERIFIED));
  }

  const [pendingDeletion] = await db.select({ id: accountDeletionRequests.id }).from(accountDeletionRequests).where(and(
    eq(accountDeletionRequests.userId, user.id),
    eq(accountDeletionRequests.status, 'pending'),
  )).limit(1);
  if (pendingDeletion) {
    return res.status(403).json(error('Account pending deletion', ErrorCode.ACCOUNT_PENDING_DELETION));
  }

  // First-login mandatory password change (random initial password)
  if (user.mustChangePassword) {
    return res.status(403).json({
      ...error('Password must be changed', ErrorCode.PASSWORD_EXPIRED),
      data: { must_change_password: true },
    });
  }

  // Check password expiry before issuing tokens (Requirements 4.1, 4.4)
  const expiryCheck = await isPasswordExpired(user.passwordChangedAt as any, tenantId);
  if (expiryCheck.expired) {
    return res.status(403).json({
      ...error('Password has expired', ErrorCode.PASSWORD_EXPIRED),
      data: {
        password_changed_at: user.passwordChangedAt,
        expires_at: expiryCheck.expiresAt,
      },
    });
  }

  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.isAdmin, tenant_id: user.tenantId, jti: crypto.randomUUID() },
    config.JWT_SECRET,
    { expiresIn: TOKEN_CONFIG.accessTokenExpiry }
  );
  const accessExpiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token: accessToken,
    clientId: 'system',
    userId: user.id,
    expiresAt: accessExpiresAt,
  });

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshDays = remember_me === true ? TOKEN_CONFIG.refreshTokenRememberMeDays : TOKEN_CONFIG.refreshTokenExpiryDays;
  const refreshExpiresAt = new Date(Date.now() + (remember_me === true ? TOKEN_CONFIG.refreshTokenRememberMeMs : TOKEN_CONFIG.refreshTokenExpiryMs));

  const sessionId = crypto.randomUUID();
  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    deviceInfo: userAgent,
    ipAddress: ip,
  });

  let newDeviceTrusted = false;
  let deviceId: string | null = null;
  if (trust_device === true) {
    const expiresAt = new Date(Date.now() + TOKEN_CONFIG.trustedDeviceExpiryMs);
    const deviceName = userAgent.substring(0, 100);
    deviceId = crypto.randomUUID();
    // Delete existing then insert (onConflictDoUpdate not available for uniqueIndex)
    await db.delete(trustedDevices).where(and(
      eq(trustedDevices.userId, user.id),
      eq(trustedDevices.deviceFingerprint, deviceFingerprint),
    ));
    await db.insert(trustedDevices).values({
      id: deviceId,
      userId: user.id,
      deviceFingerprint,
      deviceName,
      expiresAt,
      lastUsedAt: now,
    });
    newDeviceTrusted = true;
  }

  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    token: refreshToken,
    userId: user.id,
    expiresAt: refreshExpiresAt,
    rememberMe: remember_me === true,
    deviceId,
  });

  await logAudit(user.id, 'LOGIN_SUCCESS', req, `Session: ${sessionId}`, tenantId);

  res.json(success({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
    token_type: 'Bearer',
    device_trusted: newDeviceTrusted || deviceTrusted,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.isAdmin,
      otp_enabled: user.otpEnabled,
      tenant_id: user.tenantId,
    },
    session_id: sessionId,
  }, 'Login successful'));
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  const [user] = await db.select({
    id: users.id,
    username: users.username,
    email: users.email,
    fullName: users.fullName,
    phone: users.phone,
    avatarUrl: users.avatarUrl,
    isAdmin: users.isAdmin,
    otpEnabled: users.otpEnabled,
    tenantId: users.tenantId,
  }).from(users).where(eq(users.id, req.user!.id)).limit(1);

  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));
  res.json(success(user));
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const sessionId = req.headers['x-session-id'] as string | undefined;
  const currentToken = req.token;

  try {
    if (sessionId) {
      // Get trusted device IDs for this user
      const trustedDeviceIds = await db.select({ id: trustedDevices.id }).from(trustedDevices).where(eq(trustedDevices.userId, userId));
      const deviceIds = trustedDeviceIds.map(d => d.id);
      if (deviceIds.length > 0) {
        await db.update(refreshTokens).set({ revoked: true }).where(and(eq(refreshTokens.userId, userId), inArray(refreshTokens.deviceId, deviceIds)));
      }
      await db.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    } else {
      await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId));
    }

    if (currentToken) {
      await revokeToken(currentToken, RevokeReason.LOGOUT);
    }
    const tenantId = req.tenantId || req.user?.tenant_id || 'default';
    await logAudit(userId, 'LOGOUT', req, sessionId ? `Session: ${sessionId}` : 'All sessions', tenantId);
    res.json(message('Logged out successfully'));
  } catch (err: any) {
    console.error('Logout error:', err);
    res.status(500).json(error('Failed to logout', ErrorCode.SERVER_ERROR));
  }
});

// POST /api/auth/otp/setup
router.post('/otp/setup', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (user?.otpEnabled) {
    return res.status(400).json(error('OTP is already enabled. Disable it first to reconfigure.', ErrorCode.VALIDATION_FAILED));
  }

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user!.username, 'IdP Center', secret);
  await db.update(users).set({ otpSecret: secret }).where(eq(users.id, userId));

  const qrCodeUrl = await qrcode.toDataURL(otpauth);
  res.json(success({ secret, qrCodeUrl }));
});

// POST /api/auth/otp/verify
router.post('/otp/verify', authenticateToken, validate({ body: otpVerifySchema }), async (req, res) => {
  const { token } = req.body;
  const userId = req.user!.id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  const isValid = authenticator.check(token, user!.otpSecret!);
  if (isValid) {
    await db.update(users).set({ otpEnabled: true }).where(eq(users.id, userId));
    const tenantId = req.tenantId || user!.tenantId || 'default';
    await logAudit(userId, 'OTP_ENABLED', req, '', tenantId);
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
router.post('/email/verify', validate({ body: emailVerifySchema }), async (req, res) => {
  const { token } = req.body;

  const now = new Date();
  const [record] = await db.select().from(emailVerifications).where(and(
    eq(emailVerifications.token, token),
    eq(emailVerifications.used, false),
    gt(emailVerifications.expiresAt, now),
  )).limit(1);

  if (!record) {
    const [anyRecord] = await db.select().from(emailVerifications).where(eq(emailVerifications.token, token)).limit(1);
    if (anyRecord && anyRecord.used) {
      return res.status(400).json(error('Token already used', ErrorCode.TOKEN_ALREADY_USED));
    }
    return res.status(400).json(error('Token expired or invalid', ErrorCode.TOKEN_EXPIRED));
  }

  await db.update(emailVerifications).set({ used: true }).where(eq(emailVerifications.id, record.id));
  await db.update(users).set({ emailVerified: true, emailVerifiedAt: now }).where(eq(users.id, record.userId));

  await logAudit(record.userId, 'EMAIL_VERIFIED', req, 'Email verified successfully');
  res.json(message('Email verified successfully'));
});

// POST /api/auth/email/resend (authenticated)
router.post('/email/resend', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) return res.status(404).json(error('User not found', ErrorCode.RESOURCE_NOT_FOUND));
  if (user.emailVerified) return res.status(400).json(error('Email is already verified', ErrorCode.VALIDATION_ERROR));

  const verificationToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(emailVerifications).values({
    id: crypto.randomUUID(),
    userId,
    token: verificationToken,
    type: 'registration',
    expiresAt,
    used: false,
  });

  emailService.sendVerificationEmail(user.email, verificationToken, user.username).catch((err: any) => {
    console.error('Failed to send verification email:', err);
  });

  const tenantId = req.tenantId || user.tenantId || 'default';
  await logAudit(userId, 'EMAIL_VERIFICATION_RESENT', req, 'Verification email resent', tenantId);
  res.json(message('Verification email sent'));
});

// POST /api/auth/email/resend-public (public, no auth)
router.post('/email/resend-public', validate({ body: emailResendPublicSchema }), async (req, res) => {
  const { email, username } = req.body;
  const tenantId = req.tenantId;

  let user;
  if (email) {
    const [found] = await db.select().from(users).where(and(eq(users.email, email), eq(users.tenantId, tenantId))).limit(1);
    user = found;
  } else {
    const [found] = await db.select().from(users).where(and(eq(users.username, username), eq(users.tenantId, tenantId))).limit(1);
    user = found;
  }

  if (!user || user.emailVerified) {
    return res.json(message('If the account exists and is unverified, a verification link will be sent'));
  }

  const verificationToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(emailVerifications).values({
    id: crypto.randomUUID(),
    userId: user.id,
    token: verificationToken,
    type: 'registration',
    expiresAt,
    used: false,
  });

  emailService.sendVerificationEmail(user.email, verificationToken, user.username).catch((err: any) => {
    console.error('Failed to send verification email:', err);
  });

  await logAudit(user.id, 'EMAIL_VERIFICATION_RESENT', req, 'Verification email resent (public)', tenantId);
  res.json(message('If the email exists and is unverified, a verification link will be sent'));
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

  await logAudit(user.id, 'PASSWORD_RESET_REQUEST', req, `Password reset requested for ${email}`, tenantId);

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

  await logAudit(reset.userId, 'PASSWORD_RESET_COMPLETE', req, 'Password has been reset', tenantId);
  res.json(message('Password has been reset successfully'));
});

// POST /api/auth/refresh
router.post('/refresh', validate({ body: tokenRefreshSchema }), async (req, res) => {
  const { refresh_token } = req.body;

  const [storedToken] = await db.select().from(refreshTokens).where(and(
    eq(refreshTokens.token, refresh_token),
    eq(refreshTokens.revoked, false),
  )).limit(1);

  if (!storedToken) return res.status(401).json(error('Invalid refresh token', ErrorCode.TOKEN_INVALID));

  const [user] = await db.select().from(users).where(eq(users.id, storedToken.userId)).limit(1);
  if (!user || !user.isActive) return res.status(401).json(error('User not found or inactive', ErrorCode.ACCOUNT_DISABLED));

  if (user.mustChangePassword) {
    return res.status(403).json({
      ...error('Password must be changed', ErrorCode.PASSWORD_EXPIRED),
      data: { must_change_password: true },
    });
  }

  const expiryCheck = await isPasswordExpired(user.passwordChangedAt as any, user.tenantId || 'default');
  if (expiryCheck.expired) {
    return res.status(403).json({
      ...error('Password has expired', ErrorCode.PASSWORD_EXPIRED),
      data: { password_changed_at: user.passwordChangedAt, expires_at: expiryCheck.expiresAt },
    });
  }

  // Sign new access token
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.isAdmin, tenant_id: user.tenantId, jti: crypto.randomUUID() },
    config.JWT_SECRET,
    { expiresIn: TOKEN_CONFIG.accessTokenExpiry }
  );
  const accessExpiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);

  // Rotate refresh token
  const newExpiresAt = new Date(Date.now() + (storedToken.rememberMe ? TOKEN_CONFIG.refreshTokenRememberMeMs : TOKEN_CONFIG.refreshTokenExpiryMs));
  const newRefreshToken = crypto.randomBytes(32).toString('hex');

  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, storedToken.id));
  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    token: newRefreshToken,
    userId: user.id,
    clientId: storedToken.clientId,
    expiresAt: newExpiresAt,
    rememberMe: storedToken.rememberMe || false,
  });

  await logAudit(user.id, 'TOKEN_REFRESH', req, '', user.tenantId || 'default');

  res.json(success({
    access_token: accessToken,
    refresh_token: newRefreshToken,
    expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
  }));
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
    await logAudit(user.id, 'PASSWORD_CHANGED_EXPIRED', req, `Expired password changed for ${username}`, tenantId);

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

    await logAudit(user.id, 'PASSWORD_FORCE_CHANGED', req, `Initial password changed on first login`, tenantId);

    return res.json(message('Password changed successfully. Please log in with your new password.'));
  } catch (err: any) {
    console.error('force-change-password error:', err);
    return res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }
});

export default router;
