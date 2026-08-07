import express from 'express';
import crypto from 'crypto';
import { db } from '../../database.js';
import { emailService } from '../../services/email.service.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { authenticateToken } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { error, message, ErrorCode } from '../../utils/response.js';
import { users, emailVerifications } from '../../schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { emailVerifySchema, emailResendPublicSchema } from '../../validators/auth.validator.js';

const router = express.Router();

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

export default router;
