import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../../database.js';
import { emailService } from '../../services/email.service.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { validatePassword, recordPasswordHistory } from '../../services/password-policy.service.js';
import { validate } from '../../middleware/validate.js';
import { error, message, ErrorCode } from '../../utils/response.js';
import { users, emailVerifications } from '../../schema.js';
import { registerSchema } from '../../validators/auth.validator.js';

const router = express.Router();

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

export default router;
