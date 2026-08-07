import express from 'express';
import crypto from 'crypto';
import { db } from '../../database.js';
import { TOKEN_CONFIG } from '../../config.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { isPasswordExpired } from '../../services/password-policy.service.js';
import { authenticateToken } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, message, ErrorCode } from '../../utils/response.js';
import { revokeToken, RevokeReason } from '../../utils/token-blacklist.js';
import { signAccessToken } from '../../oauth/jwt.js';
import { users, accessTokens, refreshTokens, sessions, trustedDevices } from '../../schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { tokenRefreshSchema } from '../../validators/auth.validator.js';
import { sha256 } from './common.js';

const router = express.Router();

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

export default router;
