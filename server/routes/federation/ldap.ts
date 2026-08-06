import express from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { authenticateLdap, type LdapIdpConfig } from '../../services/ldap.service.js';
import { findOrLinkUser, issueDirectLoginResult } from '../../services/identity-link.service.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { success, error, ErrorCode } from '../../utils/response.js';
import { loadIdp } from './common.js';
import { federationLogin } from '../../utils/metrics.js';

const router = express.Router();

const ldapLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// POST /api/federation/:alias/ldap/login
// Unlike SAML/OIDC RP this is a same-page form POST (the browser never leaves the app), so
// it returns tokens directly instead of going through the redirect exchange-code dance.
router.post('/:alias/ldap/login', validate({ body: ldapLoginSchema }), async (req, res) => {
  const tenantId = req.tenantId;
  const { alias } = req.params;
  const { username, password } = req.body;

  const idp = await loadIdp<LdapIdpConfig>(tenantId, alias, 'ldap');
  if (!idp) return res.status(404).json(error('Identity provider not found', ErrorCode.RESOURCE_NOT_FOUND));

  let ldapResult;
  try {
    ldapResult = await authenticateLdap(idp.config, username, password);
  } catch (err: any) {
    await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_FAILED, details: `LDAP bind failed: ${err.message}`, tenantId: tenantId });
    federationLogin.inc({ provider_type: 'ldap', outcome: 'fail', tenant_id: tenantId });
    return res.status(502).json(error('Directory server error', ErrorCode.SERVICE_UNAVAILABLE));
  }

  if (!ldapResult) {
    await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_FAILED, details: `LDAP auth failed for ${username}`, tenantId: tenantId });
    federationLogin.inc({ provider_type: 'ldap', outcome: 'fail', tenant_id: tenantId });
    return res.status(401).json(error('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS));
  }

  let user;
  try {
    user = await findOrLinkUser(tenantId, `ldap:${alias}`, ldapResult.dn, {
      email: ldapResult.email,
      emailVerified: !!ldapResult.email, // the directory is the source of truth
      username: ldapResult.username,
      displayName: ldapResult.displayName,
    }, {
      linkByVerifiedEmail: idp.row.linkByVerifiedEmail ?? false,
      jitProvisioning: idp.row.jitProvisioning ?? true,
    });
  } catch (err: any) {
    await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_FAILED, details: `Account linking failed: ${err.message}`, tenantId: tenantId });
    return res.status(500).json(error('Failed to complete sign-in', ErrorCode.SERVER_ERROR));
  }

  if (!user) return res.status(403).json(error('No matching account for this identity provider', ErrorCode.AUTH_UNAUTHORIZED));
  if (!user.isActive) return res.status(403).json(error('Account is disabled', ErrorCode.ACCOUNT_DISABLED));

  await logAudit({ req, action: AuditAction.FEDERATION_LOGIN_SUCCESS, userId: user.id, details: `provider=ldap:${alias}`, tenantId: tenantId });
  federationLogin.inc({ provider_type: 'ldap', outcome: 'success', tenant_id: tenantId });

  const result = await issueDirectLoginResult(user, req);
  res.json(success(result, 'Login successful'));
});

export default router;
