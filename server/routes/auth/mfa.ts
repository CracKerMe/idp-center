import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../../database.js';
import { config } from '../../config.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import * as mfaService from '../../services/mfa.service.js';
import { authenticateToken } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, message, ErrorCode } from '../../utils/response.js';
import { mfaChallenge, mfaVerify } from '../../utils/metrics.js';
import { computeDeviceFingerprint } from '../../utils/device-fingerprint.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { users, mfaFactors } from '../../schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { otpVerifySchema } from '../../validators/auth.validator.js';
import { completeLogin, AMR_BY_FACTOR_TYPE } from './common.js';

const router = express.Router();

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

// POST /api/auth/otp/setup
// Legacy alias for /api/user/mfa/totp/setup — kept so existing clients keep working. Internally
// delegates to mfa.service.ts so the resulting factor shows up in the unified /api/user/mfa/factors
// list and login flow. New setups no longer mirror the secret into users.otp_secret: nothing reads
// that column except the one-time migrateLegacyTotpFactors() backfill for pre-2.1 accounts, so
// writing plaintext there for new factors was pure exposure with no functional benefit.
router.post('/otp/setup', authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (user?.otpEnabled) {
    return res.status(400).json(error('OTP is already enabled. Disable it first to reconfigure.', ErrorCode.VALIDATION_FAILED));
  }

  const { secret, qrCodeUrl } = await mfaService.beginTotpSetup(userId, user!.username);

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

export default router;
