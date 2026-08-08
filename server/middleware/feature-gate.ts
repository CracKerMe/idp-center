import { Request, Response, NextFunction } from 'express';
import { isEnabled } from '../services/feature.service.js';
import type { FeatureKey } from '../features/registry.js';
import { error, ErrorCode } from '../utils/response.js';

/** Blocks a route when `key` is currently disabled. Checked per-request, not at mount time,
 *  so toggling the flag takes effect without a restart. */
export function featureGate(key: FeatureKey, status: 404 | 503 = 503) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (isEnabled(key)) return next();
    res.status(status).json(error(`Feature '${key}' is currently disabled`, ErrorCode.FEATURE_DISABLED));
  };
}
