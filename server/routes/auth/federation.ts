import express from 'express';
import { db } from '../../database.js';
import { success, error, ErrorCode } from '../../utils/response.js';
import { users, accessTokens, refreshTokens, authCodes, identityProviders } from '../../schema.js';
import { eq, and, desc } from 'drizzle-orm';

const router = express.Router();

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
