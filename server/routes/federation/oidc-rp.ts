import express from 'express';
import * as client from 'openid-client';
import { eq, lt } from 'drizzle-orm';
import { db } from '../../database.js';
import { config as appConfig } from '../../config.js';
import { findOrLinkUser, issueFederatedSession } from '../../services/identity-link.service.js';
import { oauthStates } from '../../schema.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { loadIdp, loginErrorRedirect } from './common.js';
import { federationLogin } from '../../utils/metrics.js';

const router = express.Router();

interface OidcIdpConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

async function buildClientConfig(cfg: OidcIdpConfig) {
  return client.discovery(new URL(cfg.issuer), cfg.clientId, undefined, client.ClientSecretPost(cfg.clientSecret));
}

// GET /api/federation/:alias/oidc/login
router.get('/:alias/oidc/login', async (req, res) => {
  const tenantId = req.tenantId;
  const { alias } = req.params;
  const redirectAfter = typeof req.query.redirect === 'string' ? req.query.redirect : '/';

  const idp = await loadIdp<OidcIdpConfig>(tenantId, alias, 'oidc');
  if (!idp) return res.status(404).send('Identity provider not found');

  let oidcConfig;
  try {
    oidcConfig = await buildClientConfig(idp.config);
  } catch (err: any) {
    return res.status(502).send(`OIDC discovery failed: ${err.message}`);
  }

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  if (Math.random() < 0.1) {
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  }
  await db.insert(oauthStates).values({
    state,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    provider: `oidc:${alias}`,
    payload: JSON.stringify({ tenantId, alias, codeVerifier, nonce, redirectAfter }),
  });

  const callbackUrl = `${appConfig.APP_URL}/api/federation/${alias}/oidc/callback`;
  const authUrl = client.buildAuthorizationUrl(oidcConfig, {
    redirect_uri: callbackUrl,
    scope: idp.config.scope || 'openid profile email',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  res.redirect(302, authUrl.href);
});

// GET /api/federation/:alias/oidc/callback
router.get('/:alias/oidc/callback', async (req, res) => {
  const { alias } = req.params;
  const stateParam = typeof req.query.state === 'string' ? req.query.state : undefined;
  if (!stateParam) return res.redirect(302, loginErrorRedirect('Missing OIDC state'));

  const [stateRow] = await db.select().from(oauthStates).where(eq(oauthStates.state, stateParam)).limit(1);
  if (stateRow) await db.delete(oauthStates).where(eq(oauthStates.state, stateParam));
  if (!stateRow || stateRow.expiresAt < new Date()) {
    return res.redirect(302, loginErrorRedirect('Invalid or expired login attempt'));
  }

  let statePayload: { tenantId?: string; alias?: string; codeVerifier?: string; nonce?: string; redirectAfter?: string };
  try {
    statePayload = JSON.parse(stateRow.payload || '{}');
  } catch {
    statePayload = {};
  }
  const { tenantId, codeVerifier, nonce, redirectAfter } = statePayload;
  if (!tenantId || statePayload.alias !== alias) {
    return res.redirect(302, loginErrorRedirect('Login attempt does not match this provider'));
  }

  const idp = await loadIdp<OidcIdpConfig>(tenantId, alias, 'oidc');
  if (!idp) return res.redirect(302, loginErrorRedirect('Identity provider not found'));

  let oidcConfig;
  try {
    oidcConfig = await buildClientConfig(idp.config);
  } catch {
    return res.redirect(302, loginErrorRedirect('OIDC discovery failed'));
  }

  const callbackUrl = `${appConfig.APP_URL}/api/federation/${alias}/oidc/callback`;
  const currentUrl = new URL(callbackUrl);
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') currentUrl.searchParams.set(key, value);
  }

  let tokens;
  try {
    tokens = await client.authorizationCodeGrant(oidcConfig, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: stateParam,
      expectedNonce: nonce,
    });
  } catch (err: any) {
    await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_FAILED, details: `OIDC token exchange failed: ${err.message}`, tenantId: tenantId });
    federationLogin.inc({ provider_type: 'oidc', outcome: 'fail', tenant_id: tenantId });
    return res.redirect(302, loginErrorRedirect('Failed to complete sign-in'));
  }

  const claims = tokens.claims();
  if (!claims) return res.redirect(302, loginErrorRedirect('No ID token returned by provider'));

  let user;
  try {
    user = await findOrLinkUser(tenantId, `oidc:${alias}`, String(claims.sub), {
      email: typeof claims.email === 'string' ? claims.email : null,
      emailVerified: claims.email_verified === true,
      username: typeof claims.preferred_username === 'string' ? claims.preferred_username : String(claims.sub),
      displayName: typeof claims.name === 'string' ? claims.name : null,
    }, {
      linkByVerifiedEmail: idp.row.linkByVerifiedEmail ?? false,
      jitProvisioning: idp.row.jitProvisioning ?? true,
      defaultRoleIds: (idp.row.defaultRoles || '').split(',').map(s => s.trim()).filter(Boolean),
    });
  } catch (err: any) {
    await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_FAILED, details: `Account linking failed: ${err.message}`, tenantId: tenantId });
    return res.redirect(302, loginErrorRedirect('Failed to complete sign-in'));
  }

  if (!user) return res.redirect(302, loginErrorRedirect('No matching account for this identity provider'));
  if (!user.isActive) return res.redirect(302, loginErrorRedirect('Account is disabled'));

  await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_SUCCESS, userId: user.id, details: `provider=oidc:${alias}`, tenantId: tenantId });
  federationLogin.inc({ provider_type: 'oidc', outcome: 'success', tenant_id: tenantId });

  const { exchangeCode, sessionId } = await issueFederatedSession(user, req);
  const safeRedirect = redirectAfter && redirectAfter.startsWith('/') && !redirectAfter.startsWith('//') ? redirectAfter : '/';
  res.redirect(302, `/#${safeRedirect}?federation_code=${encodeURIComponent(exchangeCode)}&session_id=${encodeURIComponent(sessionId)}`);
});

export default router;
