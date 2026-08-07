import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../database.js';
import { config, SECURITY_CONFIG, TOKEN_CONFIG, MFA_CONFIG } from '../config.js';
import { emailService } from '../services/email.service.js';
import { logAudit } from '../utils/audit.js';
import { AuditAction } from '../utils/audit-actions.js';
import { validatePasswordStrength } from '../utils/password.js';
import { isPasswordExpired, validatePassword, recordPasswordHistory } from '../services/password-policy.service.js';
import { isMfaRequiredForUser } from '../services/mfa-policy.service.js';
import * as mfaService from '../services/mfa.service.js';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { success, error, message, ErrorCode, ApiResponse } from '../utils/response.js';
import { revokeToken, revokeAllUserTokens, RevokeReason } from '../utils/token-blacklist.js';
import { loginAttempts, mfaChallenge, mfaVerify } from '../utils/metrics.js';
import { signAccessToken } from '../oauth/jwt.js';
import { assessLoginRisk, recordLoginEvent, RiskAssessment } from '../services/risk.service.js';
import { logger } from '../utils/logger.js';
import { computeDeviceFingerprint } from '../utils/device-fingerprint.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { users, accessTokens, refreshTokens, sessions, emailVerifications, passwordResets, trustedDevices, accountDeletionRequests, mfaFactors, authCodes, identityProviders } from '../schema.js';
import { eq, and, gt, inArray, desc } from 'drizzle-orm';
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

type UserRow = typeof users.$inferSelect;

const sha256 = (data: string) => crypto.createHash('sha256').update(data).digest('hex');

const mfaChallengeSchema = z.object({
  mfa_token: z.string().min(1),
  factor_id: z.string().uuid(),
});

const mfaVerifySchema = z.object({
  mfa_token: z.string().min(1),
  factor_id: z.string().uuid().optional(),
  code: z.string().optional(),
  response: z.any().optional(),
});

const router = express.Router();

/** amr: RFC 8176 auth method references. acr: '0' password-only, '1' password+second-factor. */
function computeAcr(amr: string[]): string {
  return amr.length > 1 ? '1' : '0';
}

const AMR_BY_FACTOR_TYPE: Record<string, string> = {
  totp: 'otp',
  email: 'email',
  sms: 'sms',
  webauthn: 'hwk',
  recovery: 'recovery',
};

/**
 * Single token-issuance entrypoint for a fully-authenticated login — reached either
 * directly from POST /login (no MFA needed) or from POST /auth/mfa/verify (after a
 * second factor was checked). Keeping this in one place is what let device-trust,
 * session creation, and amr/acr claims stay consistent between both paths.
 */
async function completeLogin(user: UserRow, req: express.Request, opts: {
  remember_me: boolean;
  trust_device: boolean;
  deviceFingerprint: string;
  amr: string[];
  deviceTrusted: boolean;
  mfaEnrollmentRequired?: boolean;
  riskAssessment?: RiskAssessment;
}): Promise<ApiResponse> {
  const tenantId = req.tenantId || user.tenantId || 'default';
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = new Date();
  const acr = computeAcr(opts.amr);

  const sessionId = crypto.randomUUID();

  const accessToken = await signAccessToken(
    { id: user.id, username: user.username, is_admin: user.isAdmin, tenant_id: user.tenantId, bsid: sessionId, amr: opts.amr, acr },
    { expiresInSec: TOKEN_CONFIG.accessTokenExpirySeconds }
  );
  const accessExpiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token: accessToken,
    tokenHash: sha256(accessToken),
    clientId: 'system',
    userId: user.id,
    tenantId,
    expiresAt: accessExpiresAt,
  });

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + (opts.remember_me ? TOKEN_CONFIG.refreshTokenRememberMeMs : TOKEN_CONFIG.refreshTokenExpiryMs));

  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    deviceInfo: userAgent,
    ipAddress: ip,
    amr: opts.amr.join(','),
    acr,
  });

  let newDeviceTrusted = false;
  let deviceId: string | null = null;
  if (opts.trust_device) {
    const expiresAt = new Date(Date.now() + TOKEN_CONFIG.trustedDeviceExpiryMs);
    const deviceName = userAgent.substring(0, 100);
    deviceId = crypto.randomUUID();
    await db.delete(trustedDevices).where(and(
      eq(trustedDevices.userId, user.id),
      eq(trustedDevices.deviceFingerprint, opts.deviceFingerprint),
    ));
    await db.insert(trustedDevices).values({
      id: deviceId,
      userId: user.id,
      deviceFingerprint: opts.deviceFingerprint,
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
    tenantId,
    sessionId,
    expiresAt: refreshExpiresAt,
    rememberMe: opts.remember_me,
    deviceId,
  });

  await logAudit({ req, action: AuditAction.LOGIN_SUCCESS, userId: user.id, details: `Session: ${sessionId}; amr=${opts.amr.join(',')}`, tenantId: tenantId });
  loginAttempts.inc({ outcome: 'success', method: opts.amr.join(','), tenant_id: tenantId });
  recordLoginEvent({
    userId: user.id, tenantId, outcome: 'success', ip, userAgent,
    deviceFingerprint: opts.deviceFingerprint, authMethods: opts.amr, assessment: opts.riskAssessment,
  }).catch((err) => logger.warn(`recordLoginEvent failed: ${err.message}`));

  return success({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: TOKEN_CONFIG.accessTokenExpirySeconds,
    token_type: 'Bearer',
    device_trusted: newDeviceTrusted || opts.deviceTrusted,
    mfa_enrollment_required: opts.mfaEnrollmentRequired ?? false,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.isAdmin,
      otp_enabled: user.otpEnabled,
      tenant_id: user.tenantId,
    },
    session_id: sessionId,
  }, 'Login successful');
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
    await logAudit({ req, action: AuditAction.REGISTER, userId: id, details: `Registered ${username}`, tenantId: tenantId });

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

// POST /api/auth/mfa/challenge — for factor types that need a server-sent code (email/sms)
// or a fresh WebAuthn challenge. TOTP and recovery codes are verified directly at /mfa/verify.
const otpSendRateLimit = rateLimit({
  name: 'otp_send',
  limit: 5,
  windowSec: 300,
  keyFn: (req) => `${req.ip || 'unknown'}:${req.body?.mfa_token ? crypto.createHash('sha256').update(req.body.mfa_token).digest('hex') : 'unknown'}`,
});

router.post('/mfa/challenge', otpSendRateLimit, validate({ body: mfaChallengeSchema }), async (req, res) => {
  const { mfa_token, factor_id } = req.body;

  let payload: any;
  try {
    payload = jwt.verify(mfa_token, config.JWT_SECRET);
  } catch {
    return res.status(401).json(error('Invalid or expired mfa_token', ErrorCode.AUTH_MFA_TOKEN_INVALID));
  }
  if (payload.typ !== 'mfa_challenge') {
    return res.status(401).json(error('Invalid mfa_token', ErrorCode.AUTH_MFA_TOKEN_INVALID));
  }

  const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
  if (!user || !user.isActive) return res.status(401).json(error('Invalid mfa_token', ErrorCode.AUTH_MFA_TOKEN_INVALID));

  const factor = await mfaService.getActiveFactor(user.id, factor_id);
  if (!factor) return res.status(404).json(error('Factor not found', ErrorCode.RESOURCE_NOT_FOUND));

  if (factor.type === 'email' || factor.type === 'sms') {
    await mfaService.sendLoginChallenge(user.id, factor_id, user.username);
    mfaChallenge.inc({ type: factor.type, tenant_id: req.tenantId || 'default' });
    return res.json(message('Verification code sent'));
  }
  if (factor.type === 'webauthn') {
    const options = await mfaService.beginWebauthnAuthentication(user.id, factor_id);
    mfaChallenge.inc({ type: 'webauthn', tenant_id: req.tenantId || 'default' });
    return res.json(success({ options }));
  }

  res.json(message('Enter your authenticator code'));
});

// POST /api/auth/mfa/verify — completes login after a second factor is presented.
// `factor_id` selects totp/email/sms/webauthn; recovery codes omit factor_id.
router.post('/mfa/verify', validate({ body: mfaVerifySchema }), async (req, res) => {
  const { mfa_token, factor_id, code, response } = req.body;

  let payload: any;
  try {
    payload = jwt.verify(mfa_token, config.JWT_SECRET);
  } catch {
    return res.status(401).json(error('Invalid or expired mfa_token', ErrorCode.AUTH_MFA_TOKEN_INVALID));
  }
  if (payload.typ !== 'mfa_challenge') {
    return res.status(401).json(error('Invalid mfa_token', ErrorCode.AUTH_MFA_TOKEN_INVALID));
  }

  const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
  if (!user || !user.isActive) return res.status(401).json(error('Invalid mfa_token', ErrorCode.AUTH_MFA_TOKEN_INVALID));

  const tenantId = req.tenantId || payload.tenantId || 'default';
  let verified = false;
  let amrMethod: string | null = null;

  if (factor_id) {
    const factor = await mfaService.getActiveFactor(user.id, factor_id);
    if (!factor) return res.status(404).json(error('Factor not found', ErrorCode.RESOURCE_NOT_FOUND));

    if (factor.type === 'totp' && code) {
      verified = await mfaService.verifyTotp(user.id, factor_id, code);
    } else if ((factor.type === 'email' || factor.type === 'sms') && code) {
      verified = await mfaService.verifyLoginOtp(user.id, factor_id, code);
    } else if (factor.type === 'webauthn' && response) {
      verified = await mfaService.verifyWebauthnAuthentication(user.id, factor_id, response);
    }
    if (verified) amrMethod = AMR_BY_FACTOR_TYPE[factor.type] || factor.type;
  } else if (code) {
    verified = await mfaService.verifyRecoveryCode(user.id, code);
    amrMethod = AMR_BY_FACTOR_TYPE.recovery;
  }

  if (!verified || !amrMethod) {
    await logAudit({ req, action: AuditAction.LOGIN_FAILED_MFA, userId: user.id, details: 'MFA verification failed', tenantId: tenantId });
    mfaVerify.inc({ type: factor_id ? 'factor' : 'recovery', outcome: 'fail', tenant_id: tenantId });
    return res.status(401).json(error('Invalid MFA verification', ErrorCode.AUTH_OTP_INVALID));
  }

  mfaVerify.inc({ type: amrMethod, outcome: 'success', tenant_id: tenantId });

  const result = await completeLogin(user, req, {
    remember_me: !!payload.remember_me,
    trust_device: !!payload.trust_device,
    deviceFingerprint: payload.deviceFingerprint || computeDeviceFingerprint(req.get('User-Agent') || '', req.ip || 'unknown'),
    amr: ['pwd', amrMethod],
    deviceTrusted: false,
  });
  res.json(result);
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
  res.json(success({
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.fullName,
    phone: user.phone,
    avatar_url: user.avatarUrl,
    is_admin: user.isAdmin,
    otp_enabled: user.otpEnabled,
    tenant_id: user.tenantId,
  }));
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
    await logAudit({ req, action: AuditAction.LOGOUT, userId: userId, details: sessionId ? `Session: ${sessionId}` : 'All sessions', tenantId: tenantId });
    res.json(message('Logged out successfully'));
  } catch (err: any) {
    console.error('Logout error:', err);
    res.status(500).json(error('Failed to logout', ErrorCode.SERVER_ERROR));
  }
});

// POST /api/auth/otp/setup
// Legacy alias for /api/user/mfa/totp/setup — kept so existing clients (and the users.otp_enabled
// / otp_secret columns they may still read) keep working. Internally delegates to mfa.service.ts
// so the resulting factor shows up in the unified /api/user/mfa/factors list and login flow.
router.post('/otp/setup', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (user?.otpEnabled) {
    return res.status(400).json(error('OTP is already enabled. Disable it first to reconfigure.', ErrorCode.VALIDATION_FAILED));
  }

  const { secret, qrCodeUrl } = await mfaService.beginTotpSetup(userId, user!.username);
  // Mirrored for the transition window — server/schema.ts users.otp_secret/otp_enabled are
  // slated for removal once every caller reads from mfa_factors instead (see plan §2.1).
  await db.update(users).set({ otpSecret: secret }).where(eq(users.id, userId));

  res.json(success({ secret, qrCodeUrl }));
});

// POST /api/auth/otp/verify
router.post('/otp/verify', authenticateToken, validate({ body: otpVerifySchema }), async (req, res) => {
  const { token } = req.body;
  const userId = req.user!.id;

  const [pendingFactor] = await db.select().from(mfaFactors).where(and(
    eq(mfaFactors.userId, userId),
    eq(mfaFactors.type, 'totp'),
    eq(mfaFactors.status, 'pending'),
  )).orderBy(desc(mfaFactors.createdAt)).limit(1);

  const isValid = !!pendingFactor && await mfaService.confirmTotpSetup(userId, pendingFactor.id, token);
  if (isValid) {
    await db.update(users).set({ otpEnabled: true }).where(eq(users.id, userId));
    const tenantId = req.tenantId || req.user!.tenant_id || 'default';
    await logAudit({ req, action: AuditAction.OTP_ENABLED, userId: userId, tenantId: tenantId });
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

  await logAudit({ req, action: AuditAction.EMAIL_VERIFIED, userId: record.userId, details: 'Email verified successfully' });
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
  await logAudit({ req, action: AuditAction.EMAIL_VERIFICATION_RESENT, userId: userId, details: 'Verification email resent', tenantId: tenantId });
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

  await logAudit({ req, action: AuditAction.EMAIL_VERIFICATION_RESENT, userId: user.id, details: 'Verification email resent (public)', tenantId: tenantId });
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

  // Sign new access token. The refreshed token keeps the browser session id so
  // /authorize can still group OIDC sessions per browser after a silent refresh.
  const accessToken = await signAccessToken(
    { id: user.id, username: user.username, is_admin: user.isAdmin, tenant_id: user.tenantId, ...(storedToken.sessionId ? { bsid: storedToken.sessionId } : {}) },
    { expiresInSec: TOKEN_CONFIG.accessTokenExpirySeconds }
  );
  const accessExpiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);
  // isTokenRevoked() is fail-closed (no row = revoked), so the new access token must be
  // recorded here or every request using it would immediately 401.
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token: accessToken,
    tokenHash: sha256(accessToken),
    clientId: storedToken.clientId || 'system',
    userId: user.id,
    tenantId: user.tenantId || 'default',
    expiresAt: accessExpiresAt,
  });

  // Rotate refresh token
  const newExpiresAt = new Date(Date.now() + (storedToken.rememberMe ? TOKEN_CONFIG.refreshTokenRememberMeMs : TOKEN_CONFIG.refreshTokenExpiryMs));
  const newRefreshToken = crypto.randomBytes(32).toString('hex');

  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, storedToken.id));
  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    token: newRefreshToken,
    userId: user.id,
    clientId: storedToken.clientId,
    tenantId: user.tenantId || 'default',
    sessionId: storedToken.sessionId,
    expiresAt: newExpiresAt,
    rememberMe: storedToken.rememberMe || false,
  });

  await logAudit({ req, action: AuditAction.TOKEN_REFRESH, userId: user.id, tenantId: user.tenantId || 'default' });

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

// GET /api/auth/idps — public discovery for the login page's SSO buttons.
// When ?email= is given, providers whose email_domains list matches are returned first —
// the SPA can use that to auto-suggest "sign in with $displayName" for a typed email.
router.get('/idps', async (req, res) => {
  const tenantId = req.tenantId;
  const emailParam = typeof req.query.email === 'string' ? req.query.email.toLowerCase() : null;
  const domain = emailParam?.includes('@') ? emailParam.split('@')[1] : null;

  const rows = await db.select({
    alias: identityProviders.alias,
    type: identityProviders.type,
    displayName: identityProviders.displayName,
    emailDomains: identityProviders.emailDomains,
  }).from(identityProviders).where(and(
    eq(identityProviders.tenantId, tenantId),
    eq(identityProviders.enabled, true),
  ));

  const providers = rows.map(r => ({
    alias: r.alias,
    type: r.type,
    displayName: r.displayName,
    matchesEmailDomain: !!domain && (r.emailDomains || '').split(',').map(d => d.trim().toLowerCase()).includes(domain),
  }));

  providers.sort((a, b) => Number(b.matchesEmailDomain) - Number(a.matchesEmailDomain));
  res.json(success({ providers }));
});

// POST /api/auth/federation/exchange
// Shared landing point for SAML / OIDC-RP redirect logins (see identity-link.service.ts's
// issueFederatedSession) — mirrors /api/auth/github/exchange's one-time-code pattern so
// tokens never ride through the browser's address bar or history.
router.post('/federation/exchange', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json(error('Code required', ErrorCode.VALIDATION_REQUIRED));

  const [authCode] = await db
    .select()
    .from(authCodes)
    .where(and(eq(authCodes.code, code), eq(authCodes.clientId, 'federation-oauth'), eq(authCodes.scope, 'federation_login')))
    .limit(1);
  if (!authCode) return res.status(401).json(error('Invalid code', ErrorCode.TOKEN_INVALID));

  await db.delete(authCodes).where(eq(authCodes.id, authCode.id));

  if (authCode.expiresAt < new Date()) return res.status(401).json(error('Code expired', ErrorCode.TOKEN_EXPIRED));

  const [accessTokenRecord] = await db
    .select({ token: accessTokens.token })
    .from(accessTokens)
    .where(and(eq(accessTokens.userId, authCode.userId), eq(accessTokens.revoked, false)))
    .orderBy(desc(accessTokens.createdAt))
    .limit(1);

  const [refreshTokenRecord] = await db
    .select({ token: refreshTokens.token })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, authCode.userId), eq(refreshTokens.revoked, false)))
    .orderBy(desc(refreshTokens.createdAt))
    .limit(1);

  if (!accessTokenRecord || !refreshTokenRecord) return res.status(500).json(error('Token generation failed', ErrorCode.SERVER_ERROR));

  const [user] = await db
    .select({ id: users.id, username: users.username, email: users.email, isAdmin: users.isAdmin, otpEnabled: users.otpEnabled, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, authCode.userId))
    .limit(1);

  res.json(success({
    access_token: accessTokenRecord.token,
    refresh_token: refreshTokenRecord.token,
    token_type: 'Bearer',
    user,
  }));
});

export default router;
