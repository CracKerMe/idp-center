import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../../database.js';
import { config, SECURITY_CONFIG, MFA_CONFIG } from '../../config.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { isPasswordExpired } from '../../services/password-policy.service.js';
import { isMfaRequiredForUser } from '../../services/mfa-policy.service.js';
import * as mfaService from '../../services/mfa.service.js';
import { validate } from '../../middleware/validate.js';
import { error, ErrorCode } from '../../utils/response.js';
import { loginAttempts } from '../../utils/metrics.js';
import { assessLoginRisk, recordLoginEvent } from '../../services/risk.service.js';
import { logger } from '../../utils/logger.js';
import { computeDeviceFingerprint } from '../../utils/device-fingerprint.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { users, accountDeletionRequests, trustedDevices } from '../../schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { loginSchema } from '../../validators/auth.validator.js';
import { completeLogin } from './common.js';

const router = express.Router();

const loginRateLimit = rateLimit({
  name: 'login',
  limit: 10,
  windowSec: 60,
  keyFn: (req) => `${req.ip || 'unknown'}:${req.tenantId || 'default'}:${(req.body?.username || '').toLowerCase()}`,
});

// POST /api/auth/login
router.post('/login', loginRateLimit, validate({ body: loginSchema }), async (req, res) => {
  const { username, password, remember_me, trust_device } = req.body;
  const tenantId = req.tenantId;

  const [user] = await db.select().from(users).where(and(eq(users.username, username), eq(users.tenantId, tenantId))).limit(1);

  if (!user) {
    await logAudit({ req, action: AuditAction.LOGIN_FAILED, details: `Failed login for ${username}`, tenantId: tenantId });
    loginAttempts.inc({ outcome: 'fail', method: 'password', tenant_id: tenantId });
    return res.status(401).json(error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));
  }

  if (!user.isActive) {
    await logAudit({ req, action: AuditAction.LOGIN_FAILED, userId: user.id, details: `Banned user attempted login: ${username}` });
    loginAttempts.inc({ outcome: 'blocked', method: 'password', tenant_id: tenantId });
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
    await logAudit({ req, action: AuditAction.LOGIN_FAILED, userId: user.id, details: `Failed login for ${username}`, tenantId: tenantId });
    loginAttempts.inc({ outcome: 'fail', method: 'password', tenant_id: tenantId });
    recordLoginEvent({
      userId: user.id, tenantId, outcome: 'fail',
      ip: req.ip || req.connection.remoteAddress || 'unknown', userAgent: req.get('User-Agent') || '',
    }).catch((err) => logger.warn(`recordLoginEvent failed: ${err.message}`));
    return res.status(401).json(error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));
  }

  await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));

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

  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const deviceFingerprint = computeDeviceFingerprint(userAgent, ip);
  const now = new Date();

  // Adaptive auth (implementation plan §3.1). assessLoginRisk() is a no-op read when
  // RISK_ENGINE_MODE=off; in 'shadow' the score/action are computed and recorded but never
  // change the response — only 'enforce' lets risk_policies actually gate the login.
  const riskAssessment = await assessLoginRisk({ userId: user.id, tenantId, ip, userAgent, deviceFingerprint });
  const riskEnforced = config.RISK_ENGINE_MODE === 'enforce';

  if (riskEnforced && riskAssessment.action === 'deny') {
    await logAudit({
      req, action: AuditAction.RISK_LOGIN_DENIED, userId: user.id, tenantId,
      details: `score=${riskAssessment.score} signals=${riskAssessment.signals.map((s) => s.code).join(',')}`,
    });
    loginAttempts.inc({ outcome: 'blocked', method: 'password', tenant_id: tenantId });
    recordLoginEvent({ userId: user.id, tenantId, outcome: 'blocked', ip, userAgent, deviceFingerprint, assessment: riskAssessment })
      .catch((err) => logger.warn(`recordLoginEvent failed: ${err.message}`));
    return res.status(403).json(error('Login blocked by risk policy', ErrorCode.AUTH_RISK_DENIED));
  }

  const activeFactors = await mfaService.getActiveFactors(user.id);
  const mfaEnabled = activeFactors.some(f => f.type !== 'recovery');
  // A risk score demanding step-up only has teeth when the user actually has a second
  // factor enrolled — with none, there is nothing to challenge with (forcing enrollment
  // mid-login is a separate flow, out of scope here), so it silently falls back to 'allow'.
  const riskForcesStepUp = riskEnforced && mfaEnabled && (riskAssessment.action === 'mfa_required' || riskAssessment.action === 'step_up');

  if (mfaEnabled) {
    const [trustedDevice] = riskForcesStepUp ? [undefined] : await db.select({ id: trustedDevices.id }).from(trustedDevices).where(and(
      eq(trustedDevices.userId, user.id),
      eq(trustedDevices.deviceFingerprint, deviceFingerprint),
      gt(trustedDevices.expiresAt, now),
    )).limit(1);

    if (trustedDevice) {
      await db.update(trustedDevices).set({ lastUsedAt: now }).where(eq(trustedDevices.id, trustedDevice.id));
      const result = await completeLogin(user, req, {
        remember_me: remember_me === true,
        trust_device: trust_device === true,
        deviceFingerprint,
        amr: ['pwd'],
        deviceTrusted: true,
        riskAssessment,
      });
      return res.json(result);
    }

    // Second factor required — hand back a short-lived mfa_token instead of real
    // tokens. The client re-presents it (plus a chosen factor) to /mfa/challenge
    // and /mfa/verify, which complete the login via the same completeLogin() path.
    const mfaToken = jwt.sign(
      {
        typ: 'mfa_challenge',
        sub: user.id,
        tenantId,
        remember_me: remember_me === true,
        trust_device: trust_device === true,
        deviceFingerprint,
      },
      config.JWT_SECRET,
      { expiresIn: MFA_CONFIG.mfaTokenExpirySec }
    );

    if (riskForcesStepUp) {
      await logAudit({
        req, action: AuditAction.RISK_LOGIN_CHALLENGED, userId: user.id, tenantId,
        details: `score=${riskAssessment.score} signals=${riskAssessment.signals.map((s) => s.code).join(',')}`,
      });
    }
    recordLoginEvent({ userId: user.id, tenantId, outcome: 'challenged', ip, userAgent, deviceFingerprint, assessment: riskAssessment })
      .catch((err) => logger.warn(`recordLoginEvent failed: ${err.message}`));

    return res.status(403).json({
      ...error('MFA verification required', ErrorCode.AUTH_MFA_REQUIRED),
      data: {
        mfa_token: mfaToken,
        expires_in: MFA_CONFIG.mfaTokenExpirySec,
        factors: activeFactors.filter(f => f.type !== 'recovery').map(f => ({ id: f.id, type: f.type, name: f.name })),
      },
    });
  }

  const mfaEnrollmentRequired = await isMfaRequiredForUser(user.id, tenantId);
  const result = await completeLogin(user, req, {
    remember_me: remember_me === true,
    trust_device: trust_device === true,
    deviceFingerprint,
    amr: ['pwd'],
    deviceTrusted: false,
    mfaEnrollmentRequired,
    riskAssessment,
  });
  res.json(result);
});

export default router;
