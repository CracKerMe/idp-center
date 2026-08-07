import crypto from 'crypto';
import type express from 'express';
import { db } from '../../database.js';
import { TOKEN_CONFIG } from '../../config.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { ApiResponse, success } from '../../utils/response.js';
import { loginAttempts } from '../../utils/metrics.js';
import { signAccessToken } from '../../oauth/jwt.js';
import { RiskAssessment, recordLoginEvent } from '../../services/risk.service.js';
import { logger } from '../../utils/logger.js';
import { users, accessTokens, refreshTokens, sessions, trustedDevices } from '../../schema.js';
import { eventBus } from '../../services/event-bus.service.js';
import { eq, and } from 'drizzle-orm';

export type UserRow = typeof users.$inferSelect;

export const sha256 = (data: string) => crypto.createHash('sha256').update(data).digest('hex');

/** amr: RFC 8176 auth method references. acr: '0' password-only, '1' password+second-factor. */
export function computeAcr(amr: string[]): string {
  return amr.length > 1 ? '1' : '0';
}

export const AMR_BY_FACTOR_TYPE: Record<string, string> = {
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
export async function completeLogin(user: UserRow, req: express.Request, opts: {
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

  // Emit real-time event for event bus consumers
  eventBus.emit({
    id: crypto.randomUUID(),
    type: 'auth.login.success',
    tenantId,
    userId: user.id,
    timestamp: new Date(),
    payload: { method: opts.amr.join(','), sessionId, riskScore: opts.riskAssessment?.score },
    metadata: { ip, userAgent, requestId: (req as any).requestId },
  }).catch((err: any) => logger.warn(`EventBus emit failed: ${err.message}`));

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
