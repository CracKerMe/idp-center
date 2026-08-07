import express from 'express';
import crypto from 'crypto';
import { SAML } from '@node-saml/node-saml';
import { eq, lt } from 'drizzle-orm';
import { db } from '../../database.js';
import { config as appConfig } from '../../config.js';
import { findOrLinkUser, issueFederatedSession } from '../../services/identity-link.service.js';
import { oauthStates, samlAssertionIds } from '../../schema.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { loadIdp, loginErrorRedirect } from './common.js';
import { federationLogin } from '../../utils/metrics.js';

const router = express.Router();

interface SamlIdpConfig {
  entryPoint: string;
  idpCert: string;
  idpIssuer?: string;
  wantAssertionsSigned?: boolean;
  attributeMapping?: { email?: string; username?: string; displayName?: string };
}

/**
 * No SP-side signing key is provisioned here — AuthnRequests go out unsigned, which every
 * mainstream IdP (Okta, Azure AD, Google Workspace) accepts as long as the IdP-signed
 * Response/Assertion is verified (which it is, via idpCert). Admins who need signed
 * AuthnRequests can be supported later by adding spPrivateKey/spCert to the IdP config —
 * deliberately out of scope for this pass to avoid standing up a whole SP keypair
 * lifecycle (see server/services/keys.service.ts, which is RS256/JWT-specific and not a
 * natural fit for SAML's X.509 requirements).
 */
function buildSaml(alias: string, cfg: SamlIdpConfig): SAML {
  const acsUrl = `${appConfig.APP_URL}/api/federation/${alias}/saml/acs`;
  const spEntityId = `${appConfig.APP_URL}/api/federation/${alias}/saml/metadata`;
  return new SAML({
    idpCert: cfg.idpCert,
    entryPoint: cfg.entryPoint,
    issuer: spEntityId,
    callbackUrl: acsUrl,
    idpIssuer: cfg.idpIssuer,
    wantAssertionsSigned: cfg.wantAssertionsSigned ?? true,
    identifierFormat: null,
  });
}

function mapAttribute(profile: Record<string, unknown>, mapping: string | undefined, ...fallbackKeys: string[]): string | null {
  const keys = mapping ? [mapping, ...fallbackKeys] : fallbackKeys;
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

// GET /api/federation/:alias/saml/login
router.get('/:alias/saml/login', async (req, res) => {
  const tenantId = req.tenantId;
  const { alias } = req.params;
  const redirectAfter = typeof req.query.redirect === 'string' ? req.query.redirect : '/';

  const idp = await loadIdp<SamlIdpConfig>(tenantId, alias, 'saml');
  if (!idp) return res.status(404).send('Identity provider not found');

  const relayId = crypto.randomBytes(24).toString('hex');
  if (Math.random() < 0.1) {
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  }
  await db.insert(oauthStates).values({
    state: relayId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    provider: `saml:${alias}`,
    payload: JSON.stringify({ tenantId, alias, redirectAfter }),
  });

  const saml = buildSaml(alias, idp.config);
  try {
    const url = await saml.getAuthorizeUrlAsync(relayId, undefined, {});
    res.redirect(302, url);
  } catch (err: any) {
    res.status(502).send(`Failed to build SAML AuthnRequest: ${err.message}`);
  }
});

// POST /api/federation/:alias/saml/acs — Assertion Consumer Service
router.post('/:alias/saml/acs', async (req, res) => {
  const { alias } = req.params;
  const relayState = typeof req.body?.RelayState === 'string' ? req.body.RelayState : undefined;
  if (!relayState) return res.redirect(302, loginErrorRedirect('Missing SAML RelayState'));

  const [stateRow] = await db.select().from(oauthStates).where(eq(oauthStates.state, relayState)).limit(1);
  if (stateRow) await db.delete(oauthStates).where(eq(oauthStates.state, relayState));
  if (!stateRow || stateRow.expiresAt < new Date()) {
    return res.redirect(302, loginErrorRedirect('Invalid or expired login attempt'));
  }

  let statePayload: { tenantId?: string; alias?: string; redirectAfter?: string };
  try {
    statePayload = JSON.parse(stateRow.payload || '{}');
  } catch {
    statePayload = {};
  }
  const { tenantId, redirectAfter } = statePayload;
  if (!tenantId || statePayload.alias !== alias) {
    return res.redirect(302, loginErrorRedirect('Login attempt does not match this provider'));
  }

  const idp = await loadIdp<SamlIdpConfig>(tenantId, alias, 'saml');
  if (!idp) return res.redirect(302, loginErrorRedirect('Identity provider not found'));

  const saml = buildSaml(alias, idp.config);

  let profile: Record<string, unknown> | null;
  try {
    const result = await saml.validatePostResponseAsync(req.body);
    profile = result.profile as Record<string, unknown> | null;
  } catch (err: any) {
    await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_FAILED, details: `SAML assertion validation failed: ${err.message}`, tenantId: tenantId });
    federationLogin.inc({ provider_type: 'saml', outcome: 'fail', tenant_id: tenantId });
    return res.redirect(302, loginErrorRedirect('Failed to validate SAML response'));
  }
  if (!profile) return res.redirect(302, loginErrorRedirect('SAML response contained no assertion'));

  const assertionId = typeof profile.ID === 'string' ? profile.ID : null;
  if (assertionId) {
    try {
      await db.insert(samlAssertionIds).values({
        assertionId,
        idpAlias: alias,
        tenantId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    } catch {
      // Unique constraint violation = this assertion was already consumed once.
      await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_FAILED, details: `SAML assertion replay detected: ${assertionId}`, tenantId: tenantId });
      return res.redirect(302, loginErrorRedirect('This sign-in link has already been used'));
    }
  }

  const mapping = idp.row.attributeMapping ? JSON.parse(idp.row.attributeMapping) : {};
  const nameId = typeof profile.nameID === 'string' ? profile.nameID : null;
  const email = mapAttribute(profile, mapping.email, 'email', 'mail', 'urn:oid:0.9.2342.19200300.100.1.3');
  const username = mapAttribute(profile, mapping.username, 'username', 'nameID') || nameId;
  const displayName = mapAttribute(profile, mapping.displayName, 'displayName', 'name', 'cn');

  if (!nameId) return res.redirect(302, loginErrorRedirect('SAML assertion missing NameID'));

  let user;
  try {
    user = await findOrLinkUser(tenantId, `saml:${alias}`, nameId, {
      email,
      emailVerified: !!email, // the IdP is the source of truth for its own directory's email verification
      username: username || nameId,
      displayName,
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

  await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_SUCCESS, userId: user.id, details: `provider=saml:${alias}`, tenantId: tenantId });
  federationLogin.inc({ provider_type: 'saml', outcome: 'success', tenant_id: tenantId });

  const { exchangeCode, sessionId } = await issueFederatedSession(user, req);
  const safeRedirect = redirectAfter && redirectAfter.startsWith('/') && !redirectAfter.startsWith('//') ? redirectAfter : '/';
  res.redirect(302, `/#${safeRedirect}?federation_code=${encodeURIComponent(exchangeCode)}&session_id=${encodeURIComponent(sessionId)}`);
});

// GET /api/federation/:alias/saml/metadata — SP metadata for the admin to feed into the IdP.
// Not tenant-header-driven (an external IdP admin fetching this has no session) — tenant is
// picked via ?tenant_id= instead, same as tenantContext's own query-param fallback.
router.get('/:alias/saml/metadata', async (req, res) => {
  const tenantId = req.tenantId;
  const { alias } = req.params;

  const idp = await loadIdp<SamlIdpConfig>(tenantId, alias, 'saml');
  if (!idp) return res.status(404).send('Identity provider not found');

  const saml = buildSaml(alias, idp.config);
  const metadata = saml.generateServiceProviderMetadata(null, null);
  res.type('application/xml').send(metadata);
});

export default router;
