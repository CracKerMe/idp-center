import express from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { success, error, ErrorCode } from '../../utils/response.js';
import { captchaChallengeSchema, captchaVerifySchema } from '../../validators/auth.validator.js';
import { issueChallenge, verifyChallenge, loginIdentity } from '../../services/captcha.service.js';
import { captchaChallengesIssued, captchaVerifications, captchaGenerationDuration } from '../../utils/metrics.js';

const router = express.Router();

// Issuance is rate-limited independently of the login endpoint: with a ±6px
// tolerance over a ~280px travel range, an attacker doing pure binary search
// converges in ~5-6 challenges — the per-challenge attempt cap (captcha.service.ts)
// only bounds brute force if fetching a fresh challenge is itself capped too.
const captchaChallengeRateLimit = rateLimit({
  name: 'captcha_challenge',
  limit: 15,
  windowSec: 60,
  keyFn: (req) => `${req.ip || 'unknown'}:${req.tenantId || 'default'}:${(req.body?.username || '').toLowerCase()}`,
});

const captchaVerifyRateLimit = rateLimit({
  name: 'captcha_verify',
  limit: 20,
  windowSec: 60,
  keyFn: (req) => `${req.ip || 'unknown'}:${req.tenantId || 'default'}`,
});

// POST /api/auth/captcha/challenge
router.post('/captcha/challenge', captchaChallengeRateLimit, validate({ body: captchaChallengeSchema }), async (req, res) => {
  const tenantId = req.tenantId;
  const identity = loginIdentity(req.ip || 'unknown', tenantId, req.body.username);

  const startedAt = process.hrtime.bigint();
  const challenge = await issueChallenge(identity, tenantId);
  captchaGenerationDuration.observe(Number(process.hrtime.bigint() - startedAt) / 1e9);
  captchaChallengesIssued.inc({ tenant_id: tenantId });

  res.json(success(challenge));
});

// POST /api/auth/captcha/verify
router.post('/captcha/verify', captchaVerifyRateLimit, validate({ body: captchaVerifySchema }), async (req, res) => {
  const tenantId = req.tenantId;
  const { challenge_id, x, trail, input_mode } = req.body;

  const outcome = await verifyChallenge(challenge_id, x, trail, input_mode);

  if (!outcome.ok) {
    if (outcome.code === 'CAPTCHA_EXPIRED') {
      captchaVerifications.inc({ outcome: 'expired', tenant_id: tenantId });
      return res.status(400).json(error('Challenge expired, request a new one', ErrorCode.CAPTCHA_EXPIRED));
    }
    captchaVerifications.inc({ outcome: 'invalid', tenant_id: tenantId });
    return res.status(400).json({
      ...error('Puzzle not aligned', ErrorCode.CAPTCHA_INVALID),
      data: { attempts_remaining: outcome.attemptsRemaining, challenge_id },
    });
  }

  captchaVerifications.inc({ outcome: 'success', tenant_id: tenantId });
  res.json(success({ captcha_pass: outcome.captchaPass, expires_in: outcome.expiresIn }));
});

export default router;
