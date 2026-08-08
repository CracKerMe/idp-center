import express from 'express';
import { success } from '../utils/response.js';
import { isEnabled } from '../services/feature.service.js';
import type { FeatureKey } from '../features/registry.js';

const router = express.Router();

// Keys safe to expose unauthenticated: only ones that gate a visible UI affordance (e.g. the
// login page's GitHub button or device-flow link). Deliberately EXCLUDES riskEngine/captcha
// (anti-abuse posture — don't tell attackers which mode is active) and internal-ops-only
// flags (alert/autoHeal/healthChecker/uebaBaseline/aiAssist/the three placeholder flags).
const PUBLIC_KEYS: readonly FeatureKey[] = ['githubSso', 'deviceFlow', 'mfa', 'dynamicClientRegistration'];

// GET /api/features/public
router.get('/public', (_req, res) => {
  const data = Object.fromEntries(PUBLIC_KEYS.map(k => [k, isEnabled(k)]));
  res.json(success(data));
});

export default router;
