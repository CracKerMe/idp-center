import express from 'express';
import crypto from 'crypto';
import { db } from '../../database.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import { authenticateAdmin, authenticatePlatformAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, message, ErrorCode } from '../../utils/response.js';
import { getTenantPasswordPolicy } from '../../services/password-policy.service.js';
import { parseCidr } from '../../middleware/ip-whitelist.js';
import { users, tenants, tenantPasswordPolicies, tenantIpWhitelist } from '../../schema.js';
import { eq, and, desc, asc } from 'drizzle-orm';
import { tenantIdParamsSchema, createTenantSchema, updateTenantSchema, passwordPolicySchema, ipWhitelistEntrySchema } from '../../validators/admin.validator.js';
import { requireOwnTenantOrPlatformAdmin } from './common.js';

const router = express.Router();

// GET /api/admin/tenants
router.get('/tenants', authenticatePlatformAdmin, async (req, res) => {
  const tenantList = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
  res.json(success(tenantList));
});

// POST /api/admin/tenants
router.post('/tenants', authenticatePlatformAdmin, validate({ body: createTenantSchema }), async (req, res) => {
  const { name, domain, settings } = req.body;

  const id = crypto.randomUUID();
  await db.insert(tenants).values({
    id,
    name,
    domain: domain || null,
    settings: JSON.stringify(settings || {}),
  });

  await logAudit({ req, action: AuditAction.TENANT_CREATE, userId: req.user!.id, details: `Created tenant: ${name}` });
  res.json(success({ id }, 'Tenant created successfully'));
});

// PUT /api/admin/tenants/:tenantId
router.put('/tenants/:tenantId', authenticatePlatformAdmin, validate({ params: tenantIdParamsSchema, body: updateTenantSchema }), async (req, res) => {
  const { tenantId } = req.params;
  const { name, domain, is_active, settings } = req.body;

  await db.update(tenants).set({
    name,
    domain,
    isActive: is_active,
    settings: JSON.stringify(settings || {}),
  }).where(eq(tenants.id, tenantId));

  await logAudit({ req, action: AuditAction.TENANT_UPDATE, userId: req.user!.id, details: `Updated tenant: ${tenantId}` });
  res.json(message('Tenant updated successfully'));
});

// DELETE /api/admin/tenants/:tenantId
router.delete('/tenants/:tenantId', authenticatePlatformAdmin, validate({ params: tenantIdParamsSchema }), async (req, res) => {
  const { tenantId } = req.params;
  if (tenantId === 'default') return res.status(400).json(error('Cannot delete default tenant', ErrorCode.VALIDATION_ERROR));

  await db.update(users).set({ tenantId: 'default', updatedAt: new Date() }).where(eq(users.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));

  await logAudit({ req, action: AuditAction.TENANT_DELETE, userId: req.user!.id, details: `Deleted tenant: ${tenantId}` });
  res.json(message('Tenant deleted successfully'));
});

// GET /api/admin/tenants/:tenantId/password-policy
router.get('/tenants/:tenantId/password-policy', authenticateAdmin, requireOwnTenantOrPlatformAdmin, validate({ params: tenantIdParamsSchema }), async (req, res) => {
  const { tenantId } = req.params;
  const policy = await getTenantPasswordPolicy(tenantId);

  const [row] = await db
    .select({ tenantId: tenantPasswordPolicies.tenantId, updatedAt: tenantPasswordPolicies.updatedAt })
    .from(tenantPasswordPolicies)
    .where(eq(tenantPasswordPolicies.tenantId, tenantId))
    .limit(1);

  res.json(success({
    tenant_id: tenantId,
    ...policy,
    updated_at: row?.updatedAt ?? null,
  }));
});

// PUT /api/admin/tenants/:tenantId/password-policy
router.put('/tenants/:tenantId/password-policy', authenticateAdmin, requireOwnTenantOrPlatformAdmin, validate({ params: tenantIdParamsSchema, body: passwordPolicySchema }), async (req, res) => {
  const { tenantId } = req.params;
  const { min_length, history_count, rotation_enabled, rotation_period_days } = req.body;

  await db.insert(tenantPasswordPolicies).values({
    id: crypto.randomUUID(),
    tenantId,
    minLength: min_length,
    historyCount: history_count,
    rotationEnabled: rotation_enabled,
    rotationPeriodDays: rotation_period_days,
  }).onConflictDoUpdate({
    target: tenantPasswordPolicies.tenantId,
    set: {
      minLength: min_length,
      historyCount: history_count,
      rotationEnabled: rotation_enabled,
      rotationPeriodDays: rotation_period_days,
      updatedAt: new Date(),
    },
  });

  res.json(message('Password policy updated successfully'));
});

// GET /api/admin/tenants/:tenantId/ip-whitelist
router.get('/tenants/:tenantId/ip-whitelist', authenticateAdmin, requireOwnTenantOrPlatformAdmin, validate({ params: tenantIdParamsSchema }), async (req, res) => {
  const { tenantId } = req.params;

  const entries = await db
    .select({
      id: tenantIpWhitelist.id,
      cidr: tenantIpWhitelist.cidr,
      description: tenantIpWhitelist.description,
      createdBy: tenantIpWhitelist.createdBy,
      createdAt: tenantIpWhitelist.createdAt,
    })
    .from(tenantIpWhitelist)
    .where(eq(tenantIpWhitelist.tenantId, tenantId))
    .orderBy(asc(tenantIpWhitelist.createdAt));

  res.json(success(entries));
});

// POST /api/admin/tenants/:tenantId/ip-whitelist
router.post('/tenants/:tenantId/ip-whitelist', authenticateAdmin, requireOwnTenantOrPlatformAdmin, validate({ params: tenantIdParamsSchema, body: ipWhitelistEntrySchema }), async (req, res) => {
  const { tenantId } = req.params;
  const { cidr, description } = req.body;

  // Validate CIDR format
  if (!parseCidr(cidr)) {
    return res.status(400).json(error('Invalid CIDR format', ErrorCode.INVALID_CIDR_FORMAT));
  }

  const id = crypto.randomUUID();
  const createdBy = req.user?.id || null;

  try {
    await db.insert(tenantIpWhitelist).values({
      id,
      tenantId,
      cidr,
      description: description || null,
      createdBy,
    });
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json(error('CIDR already exists for this tenant', ErrorCode.CIDR_ALREADY_EXISTS));
    }
    return res.status(500).json(error('Internal server error', ErrorCode.SERVER_ERROR));
  }

  await logAudit({ req, action: AuditAction.IP_WHITELIST_ADDED, userId: createdBy, details: JSON.stringify({ tenant_id: tenantId, cidr, description }), tenantId: tenantId });
  res.status(201).json(success({ id }, 'IP whitelist entry added'));
});

// DELETE /api/admin/tenants/:tenantId/ip-whitelist/:entryId
router.delete('/tenants/:tenantId/ip-whitelist/:entryId', authenticateAdmin, requireOwnTenantOrPlatformAdmin, async (req, res) => {
  const { tenantId, entryId } = req.params;

  const [entry] = await db
    .select({ id: tenantIpWhitelist.id })
    .from(tenantIpWhitelist)
    .where(and(eq(tenantIpWhitelist.id, entryId), eq(tenantIpWhitelist.tenantId, tenantId)))
    .limit(1);

  if (!entry) {
    return res.status(404).json(error('IP whitelist entry not found', ErrorCode.RESOURCE_NOT_FOUND));
  }

  await db
    .delete(tenantIpWhitelist)
    .where(and(eq(tenantIpWhitelist.id, entryId), eq(tenantIpWhitelist.tenantId, tenantId)));

  const userId = req.user?.id || null;
  await logAudit({ req, action: AuditAction.IP_WHITELIST_REMOVED, userId: userId, details: JSON.stringify({ tenant_id: tenantId, entry_id: entryId }), tenantId: tenantId });
  res.json(message('IP whitelist entry removed'));
});

export default router;
