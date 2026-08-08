import { Request, Response, NextFunction } from 'express';
import { getValue } from '../services/feature.service.js';
import { error, ErrorCode } from '../utils/response.js';
import { isCaptchaRequired, consumeCaptchaPass, loginIdentity } from '../services/captcha.service.js';
import { captchaTriggered, captchaFailOpen } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

/**
 * Gates POST /login before any DB lookup or bcrypt compare (see
 * server/routes/auth/login.ts, which puts this middleware ahead of the handler
 * body). It only asks "does this ip+tenant+username currently need a captcha,
 * and if so, is a valid one-time captcha_pass present?" — all pixel/trajectory
 * logic lives in captcha.service.ts / captcha-verify.ts and is never touched here.
 *
 * Fails open on any cache error, matching rate-limit.ts's stated philosophy
 * ("an unreachable Redis must not take down login"): a cache outage already
 * disables loginRateLimit identically, so this doesn't open a *new* hole — the
 * fail-open path is counted so ops see a live bypass window immediately.
 */
export async function captchaGuard(req: Request, res: Response, next: NextFunction) {
  if (getValue('captcha') === 'off') return next();

  const tenantId = req.tenantId || 'default';
  const identity = loginIdentity(req.ip || 'unknown', tenantId, req.body?.username || '');

  try {
    const required = await isCaptchaRequired(identity);
    if (!required) return next();

    if (getValue('captcha') === 'shadow') {
      captchaTriggered.inc({ mode: 'shadow', tenant_id: tenantId });
      return next();
    }

    captchaTriggered.inc({ mode: 'enforce', tenant_id: tenantId });

    const pass = req.body?.captcha_pass;
    if (!pass || typeof pass !== 'string') {
      return res.status(403).json(error('Captcha verification required', ErrorCode.CAPTCHA_REQUIRED));
    }

    const valid = await consumeCaptchaPass(pass, identity);
    if (!valid) {
      return res.status(403).json(error('Captcha verification required', ErrorCode.CAPTCHA_REQUIRED));
    }

    next();
  } catch (err: any) {
    logger.warn(`captchaGuard failed open: ${err.message}`);
    captchaFailOpen.inc();
    next();
  }
}
