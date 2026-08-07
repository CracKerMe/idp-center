import express from 'express';
import { getCache } from '../services/cache.service.js';
import { error, ErrorCode } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export interface RateLimitOptions {
  /** Short name used as part of the cache key namespace, e.g. 'login', 'token', 'otp'. */
  name: string;
  limit: number;
  windowSec: number;
  /** Defaults to `${req.ip}:${req.tenantId}`. Override to key on e.g. username too. */
  keyFn?: (req: express.Request) => string;
}

/**
 * Shared-backend rate limiter (implementation plan §4.2 — "当前完全没有限流，这是上生产前的
 * 硬缺口"). Backed by cache.service.ts, so it's correct across replicas once REDIS_URL is
 * set and degrades to a per-instance limit (still better than nothing) when it isn't.
 * Fails open on cache errors — an unreachable Redis must not take down login.
 */
export function rateLimit(opts: RateLimitOptions): express.RequestHandler {
  return async (req, res, next) => {
    try {
      const cache = await getCache();
      const identity = opts.keyFn ? opts.keyFn(req) : `${req.ip || 'unknown'}:${req.tenantId || 'default'}`;
      const key = `ratelimit:${opts.name}:${identity}`;
      const count = await cache.incr(key, opts.windowSec);

      res.setHeader('X-RateLimit-Limit', String(opts.limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, opts.limit - count)));

      if (count > opts.limit) {
        return res.status(429).json(error('Too many requests, please try again later', ErrorCode.RATE_LIMITED));
      }
      next();
    } catch (err: any) {
      logger.warn(`rateLimit(${opts.name}) failed open: ${err.message}`);
      next();
    }
  };
}
