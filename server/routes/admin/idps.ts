import express from 'express';
import crypto from 'crypto';
import { db } from '../../database.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { authenticateAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, message, ErrorCode } from '../../utils/response.js';
import { encryptToken, decryptToken } from '../../services/crypto.js';
import { identityProviders } from '../../schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { createIdpSchema, updateIdpSchema, idpIdParamsSchema } from '../../validators/admin.validator.js';

const router = express.Router();

const IDP_SECRET_KEYS = ['clientSecret', 'bindPassword', 'spPrivateKey'];

/** Never echo back secrets in a GET/list response — the admin re-enters them to change them. */
function redactIdpConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...cfg };
  for (const key of IDP_SECRET_KEYS) {
    if (redacted[key]) redacted[key] = '••••••••';
  }
  return redacted;
}

function idpToResponse(row: typeof identityProviders.$inferSelect) {
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(decryptToken(row.configEnc)); } catch { /* leave empty on decrypt failure */ }
  return {
    id: row.id,
    alias: row.alias,
    type: row.type,
    displayName: row.displayName,
    enabled: row.enabled,
    config: redactIdpConfig(config),
    attributeMapping: JSON.parse(row.attributeMapping || '{}'),
    jitProvisioning: row.jitProvisioning,
    linkByVerifiedEmail: row.linkByVerifiedEmail,
    defaultRoles: row.defaultRoles,
    emailDomains: row.emailDomains,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /api/admin/idps
router.get('/idps', authenticateAdmin, async (req, res) => {
  const rows = await db.select().from(identityProviders).where(eq(identityProviders.tenantId, req.tenantId)).orderBy(desc(identityProviders.createdAt));
  res.json(success(rows.map(idpToResponse)));
});

// POST /api/admin/idps
router.post('/idps', authenticateAdmin, validate({ body: createIdpSchema }), async (req, res) => {
  const { alias, type, displayName, enabled, config: idpConfig, attributeMapping, jitProvisioning, linkByVerifiedEmail, defaultRoles, emailDomains } = req.body;
  const id = crypto.randomUUID();

  try {
    await db.insert(identityProviders).values({
      id,
      tenantId: req.tenantId,
      alias,
      type,
      displayName,
      enabled: enabled ?? true,
      configEnc: encryptToken(JSON.stringify(idpConfig)),
      attributeMapping: JSON.stringify(attributeMapping || {}),
      jitProvisioning: jitProvisioning ?? true,
      linkByVerifiedEmail: linkByVerifiedEmail ?? false,
      defaultRoles: defaultRoles || null,
      emailDomains: emailDomains || null,
    });
  } catch (err: any) {
    if (err.message?.includes('duplicate key')) return res.status(409).json(error('An identity provider with this alias already exists', ErrorCode.RESOURCE_ALREADY_EXISTS));
    return res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }

  await logAudit({ req, action: AuditAction.IDP_CREATED, userId: req.user!.id, details: JSON.stringify({ alias, type }), tenantId: req.tenantId });
  res.status(201).json(success({ id }, 'Identity provider created'));
});

// PUT /api/admin/idps/:id
router.put('/idps/:id', authenticateAdmin, validate({ params: idpIdParamsSchema, body: updateIdpSchema }), async (req, res) => {
  const [existing] = await db.select().from(identityProviders).where(and(eq(identityProviders.id, req.params.id), eq(identityProviders.tenantId, req.tenantId))).limit(1);
  if (!existing) return res.status(404).json(error('Identity provider not found', ErrorCode.RESOURCE_NOT_FOUND));

  const { displayName, enabled, config: idpConfig, attributeMapping, jitProvisioning, linkByVerifiedEmail, defaultRoles, emailDomains } = req.body;
  const updateData: Record<string, any> = { updatedAt: new Date() };

  if (displayName !== undefined) updateData.displayName = displayName;
  if (enabled !== undefined) updateData.enabled = enabled;
  if (attributeMapping !== undefined) updateData.attributeMapping = JSON.stringify(attributeMapping);
  if (jitProvisioning !== undefined) updateData.jitProvisioning = jitProvisioning;
  if (linkByVerifiedEmail !== undefined) updateData.linkByVerifiedEmail = linkByVerifiedEmail;
  if (defaultRoles !== undefined) updateData.defaultRoles = defaultRoles;
  if (emailDomains !== undefined) updateData.emailDomains = emailDomains;

  if (idpConfig !== undefined) {
    // Merge onto the existing decrypted config so the admin can update one field (e.g.
    // displayName) via PUT without being forced to re-submit every secret every time —
    // fields sent back as the "••••••••" placeholder are left untouched rather than
    // overwritten with the literal placeholder string.
    let current: Record<string, unknown> = {};
    try { current = JSON.parse(decryptToken(existing.configEnc)); } catch { /* start fresh on decrypt failure */ }
    const merged = { ...current, ...(idpConfig as Record<string, unknown>) };
    for (const key of IDP_SECRET_KEYS) {
      if (merged[key] === '••••••••') merged[key] = current[key];
    }
    updateData.configEnc = encryptToken(JSON.stringify(merged));
  }

  await db.update(identityProviders).set(updateData).where(eq(identityProviders.id, req.params.id));
  await logAudit({ req, action: AuditAction.IDP_UPDATED, userId: req.user!.id, details: JSON.stringify({ id: req.params.id }), tenantId: req.tenantId });
  res.json(message('Identity provider updated'));
});

// DELETE /api/admin/idps/:id
router.delete('/idps/:id', authenticateAdmin, validate({ params: idpIdParamsSchema }), async (req, res) => {
  const [existing] = await db.select({ id: identityProviders.id }).from(identityProviders).where(and(eq(identityProviders.id, req.params.id), eq(identityProviders.tenantId, req.tenantId))).limit(1);
  if (!existing) return res.status(404).json(error('Identity provider not found', ErrorCode.RESOURCE_NOT_FOUND));

  await db.delete(identityProviders).where(eq(identityProviders.id, req.params.id));
  await logAudit({ req, action: AuditAction.IDP_DELETED, userId: req.user!.id, details: JSON.stringify({ id: req.params.id }), tenantId: req.tenantId });
  res.json(message('Identity provider deleted'));
});

export default router;
