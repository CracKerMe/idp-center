import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { commonSchemas } from '../middleware/validate.js';
import { success, error, message, ErrorCode } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { AuditAction } from '../utils/audit-actions.js';
import { users, mfaFactors } from '../schema.js';
import { eq, and } from 'drizzle-orm';
import * as mfaService from '../services/mfa.service.js';
import { rateLimit } from '../middleware/rate-limit.js';

const router = express.Router();

const otpSendRateLimit = rateLimit({
  name: 'mfa_otp_send',
  limit: 5,
  windowSec: 300,
  keyFn: (req) => `${req.ip || 'unknown'}:${req.user?.id || 'anon'}`,
});

// GET /api/user/mfa/factors
router.get('/factors', authenticateToken, async (req, res) => {
  const factors = await mfaService.listFactors(req.user!.id);
  const recoveryCount = await mfaService.countRemainingRecoveryCodes(req.user!.id);
  res.json(success({ factors, recovery_codes_remaining: recoveryCount }));
});

// --- TOTP ---

router.post('/totp/setup', authenticateToken, async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
  const result = await mfaService.beginTotpSetup(req.user!.id, user!.username);
  res.json(success(result));
});

router.post('/totp/verify', authenticateToken, validate({ body: z.object({ factorId: z.string().uuid(), token: commonSchemas.otp }) }), async (req, res) => {
  const { factorId, token } = req.body;
  const ok = await mfaService.confirmTotpSetup(req.user!.id, factorId, token);
  if (!ok) return res.status(400).json(error('Invalid code', ErrorCode.AUTH_OTP_INVALID));

  const tenantId = req.tenantId || req.user!.tenant_id || 'default';
  await logAudit({ req, action: AuditAction.MFA_FACTOR_ENABLED, userId: req.user!.id, details: 'type=totp', tenantId: tenantId });
  res.json(success({ enabled: true }, 'TOTP enabled successfully'));
});

// --- Email OTP ---

router.post('/email/setup', authenticateToken, otpSendRateLimit, validate({ body: z.object({ email: commonSchemas.email.optional() }) }), async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
  const email = req.body.email || user!.email;
  const result = await mfaService.beginEmailFactorSetup(req.user!.id, email, user!.username);
  res.json(success({ factorId: result.factorId, email }));
});

router.post('/email/verify', authenticateToken, validate({ body: z.object({ factorId: z.string().uuid(), code: commonSchemas.otp }) }), async (req, res) => {
  const { factorId, code } = req.body;
  const ok = await mfaService.confirmEmailOrSmsSetup(req.user!.id, factorId, code);
  if (!ok) return res.status(400).json(error('Invalid or expired code', ErrorCode.AUTH_OTP_INVALID));

  const tenantId = req.tenantId || req.user!.tenant_id || 'default';
  await logAudit({ req, action: AuditAction.MFA_FACTOR_ENABLED, userId: req.user!.id, details: 'type=email', tenantId: tenantId });
  res.json(success({ enabled: true }, 'Email factor enabled successfully'));
});

// --- SMS OTP ---

router.post('/sms/setup', authenticateToken, otpSendRateLimit, validate({ body: z.object({ phone: z.string().min(5).max(20) }) }), async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
  const result = await mfaService.beginSmsFactorSetup(req.user!.id, req.body.phone, user!.username);
  res.json(success({ factorId: result.factorId, phone: req.body.phone }));
});

router.post('/sms/verify', authenticateToken, validate({ body: z.object({ factorId: z.string().uuid(), code: commonSchemas.otp }) }), async (req, res) => {
  const { factorId, code } = req.body;
  const ok = await mfaService.confirmEmailOrSmsSetup(req.user!.id, factorId, code);
  if (!ok) return res.status(400).json(error('Invalid or expired code', ErrorCode.AUTH_OTP_INVALID));

  const tenantId = req.tenantId || req.user!.tenant_id || 'default';
  await logAudit({ req, action: AuditAction.MFA_FACTOR_ENABLED, userId: req.user!.id, details: 'type=sms', tenantId: tenantId });
  res.json(success({ enabled: true }, 'SMS factor enabled successfully'));
});

// --- WebAuthn ---

router.post('/webauthn/register/options', authenticateToken, async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
  const { factorId, options } = await mfaService.beginWebauthnRegistration(req.user!.id, user!.username);
  res.json(success({ factorId, options }));
});

router.post('/webauthn/register/verify', authenticateToken, validate({ body: z.object({ factorId: z.string().uuid(), response: z.any(), name: z.string().max(100).optional() }) }), async (req, res) => {
  const { factorId, response, name } = req.body;
  try {
    const ok = await mfaService.finishWebauthnRegistration(req.user!.id, factorId, response, name);
    if (!ok) return res.status(400).json(error('WebAuthn verification failed', ErrorCode.VALIDATION_FAILED));
  } catch (err: any) {
    return res.status(400).json(error(err.message || 'WebAuthn verification failed', ErrorCode.VALIDATION_FAILED));
  }

  const tenantId = req.tenantId || req.user!.tenant_id || 'default';
  await logAudit({ req, action: AuditAction.MFA_FACTOR_ENABLED, userId: req.user!.id, details: 'type=webauthn', tenantId: tenantId });
  res.json(success({ enabled: true }, 'Security key registered successfully'));
});

// --- Recovery codes ---

router.post('/recovery/generate', authenticateToken, async (req, res) => {
  const hasOtherFactor = await mfaService.hasMfaEnabled(req.user!.id);
  if (!hasOtherFactor) {
    return res.status(400).json(error('Enable at least one other MFA factor before generating recovery codes', ErrorCode.VALIDATION_FAILED));
  }

  const codes = await mfaService.generateRecoveryCodes(req.user!.id);
  const tenantId = req.tenantId || req.user!.tenant_id || 'default';
  await logAudit({ req, action: AuditAction.MFA_RECOVERY_CODES_GENERATED, userId: req.user!.id, details: `count=${codes.length}`, tenantId: tenantId });
  res.json(success({ codes }, 'Store these codes somewhere safe — they will not be shown again'));
});

// --- Disable factor (requires password reauth) ---

router.delete('/factors/:id', authenticateToken, validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ password: z.string().min(1) }) }), async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
  if (!user || !await bcrypt.compare(req.body.password, user.passwordHash)) {
    return res.status(401).json(error('Invalid password', ErrorCode.AUTH_INVALID_CREDENTIALS));
  }

  const [factor] = await db.select({ type: mfaFactors.type }).from(mfaFactors).where(and(eq(mfaFactors.id, req.params.id), eq(mfaFactors.userId, req.user!.id))).limit(1);
  const ok = await mfaService.disableFactor(req.user!.id, req.params.id);
  if (!ok) return res.status(404).json(error('Factor not found', ErrorCode.RESOURCE_NOT_FOUND));

  const tenantId = req.tenantId || req.user!.tenant_id || 'default';
  await logAudit({ req, action: AuditAction.MFA_FACTOR_DISABLED, userId: req.user!.id, details: `type=${factor?.type}`, tenantId: tenantId });
  res.json(message('MFA factor disabled'));
});

export default router;
