import express from 'express';
import { z } from 'zod';
import { authenticatePlatformAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { success, error, ErrorCode } from '../../utils/response.js';
import { logAudit } from '../../utils/audit.js';
import { AuditAction } from '../../utils/audit-actions.js';
import * as featureService from '../../services/feature.service.js';
import { FEATURE_REGISTRY, type FeatureKey } from '../../features/registry.js';

const router = express.Router();

// GET /api/admin/features — full registry + resolved value + provenance (platform-admin only,
// feature flags are a global/system-level resource, not tenant-scoped).
router.get('/features', authenticatePlatformAdmin, (_req, res) => {
  const items = featureService.listResolved().map(({ key, def, value, source }) => ({
    key,
    category: def.category,
    categoryLabel: def.categoryLabel,
    label: def.label,
    description: def.description,
    type: def.type,
    options: def.type === 'triState' ? def.options : undefined,
    value,
    source,
    effectiveImmediately: def.effect === 'immediate',
    implemented: def.implemented,
    dependsOn: def.dependsOn ?? [],
    dependenciesSatisfied: (def.dependsOn ?? []).every(d => featureService.isEnabled(d as FeatureKey)),
    hardRequirementUnmet: !!def.hardRequirement && !def.hardRequirement.met(),
    hardRequirementReason: def.hardRequirement?.reasonZh,
  }));
  res.json(success(items));
});

const setFlagBodySchema = z.object({ value: z.union([z.boolean(), z.enum(['off', 'shadow', 'enforce'])]) });
const keyParamsSchema = z.object({ key: z.string() });

// PUT /api/admin/features/:key
router.put('/features/:key', authenticatePlatformAdmin, validate({ params: keyParamsSchema, body: setFlagBodySchema }), async (req, res) => {
  const key = req.params.key as FeatureKey;
  if (!(key in FEATURE_REGISTRY)) {
    return res.status(404).json(error('Unknown feature key', ErrorCode.RESOURCE_NOT_FOUND));
  }

  try {
    await featureService.setFlag(key, req.body.value, req.user!.id);
    await logAudit({
      req,
      action: AuditAction.FEATURE_FLAG_UPDATED,
      userId: req.user!.id,
      details: `${key}=${JSON.stringify(req.body.value)}`,
    });
    res.json(success({ key, value: featureService.getValue(key), source: featureService.getSource(key) }));
  } catch (err: any) {
    if (err instanceof featureService.DependencyViolationError) {
      return res.status(409).json(error(err.message, ErrorCode.DEPENDENCY_VIOLATION));
    }
    if (err instanceof featureService.InvalidFeatureValueError) {
      return res.status(400).json(error(err.message, ErrorCode.VALIDATION_ERROR));
    }
    res.status(500).json(error(err.message));
  }
});

// POST /api/admin/features/reset/:key — drop the DB override, fall back to the env default
router.post('/features/reset/:key', authenticatePlatformAdmin, validate({ params: keyParamsSchema }), async (req, res) => {
  const key = req.params.key as FeatureKey;
  if (!(key in FEATURE_REGISTRY)) {
    return res.status(404).json(error('Unknown feature key', ErrorCode.RESOURCE_NOT_FOUND));
  }

  await featureService.resetFlag(key, req.user!.id);
  await logAudit({ req, action: AuditAction.FEATURE_FLAG_RESET, userId: req.user!.id, details: key });
  res.json(success({ key, value: featureService.getValue(key), source: featureService.getSource(key) }));
});

export default router;
