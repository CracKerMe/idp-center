import { Router } from 'express';
import { runHealthCheck, persistHealthCheck, getHealthHistory } from '../services/health-checker.service.js';
import { autoHealTick, getAutoHealLog, getHealRules, updateHealRule } from '../services/auto-heal.service.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { featureGate } from '../middleware/feature-gate.js';
import { success, error } from '../utils/response.js';

const router = Router();

// All operations endpoints require admin auth.
// Note: authenticateAdmin already calls authenticateToken internally,
// so we don't need to chain them (avoids double JWT verification).

/**
 * GET /api/ops/health/comprehensive — Full health check (admin only, read-only)
 * Does NOT persist — no write side effect on GET.
 */
router.get('/health/comprehensive', authenticateAdmin, featureGate('healthChecker'), async (_req, res) => {
  try {
    const result = await runHealthCheck();
    res.json(success(result));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

/**
 * POST /api/ops/health/persist — Persist a health check result (admin only)
 * Separate endpoint for write operations.
 */
router.post('/health/persist', authenticateAdmin, featureGate('healthChecker'), async (_req, res) => {
  try {
    const result = await runHealthCheck();
    await persistHealthCheck(result);
    res.json(success(result));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

/**
 * GET /api/ops/health/history — Health check history (admin only)
 */
router.get('/health/history', authenticateAdmin, async (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const history = await getHealthHistory(hours);
    res.json(success(history));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

/**
 * GET /api/ops/auto-heal/log — Auto-heal execution log (admin only)
 */
router.get('/auto-heal/log', authenticateAdmin, async (req: any, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const log = await getAutoHealLog(hours);
    res.json(success(log));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

/**
 * GET /api/ops/auto-heal/rules — List heal rules (admin only)
 */
router.get('/auto-heal/rules', authenticateAdmin, (_req, res) => {
  res.json(success(getHealRules()));
});

/**
 * PUT /api/ops/auto-heal/rules/:id — Update heal rule (admin only)
 */
router.put('/auto-heal/rules/:id', authenticateAdmin, (req: any, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json(error('enabled must be a boolean'));
  }
  const result = updateHealRule(req.params.id, enabled);
  if (!result) return res.status(404).json(error('Rule not found'));
  res.json(success({ updated: true }));
});

/**
 * POST /api/ops/auto-heal/tick — Manual trigger (admin only)
 */
router.post('/auto-heal/tick', authenticateAdmin, featureGate('autoHeal'), async (_req, res) => {
  try {
    await autoHealTick();
    res.json(success({ triggered: true }));
  } catch (err: any) {
    res.status(500).json(error(err.message));
  }
});

export default router;
