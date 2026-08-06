import type { Request, Response, NextFunction } from 'express';
import { httpRequestDuration, httpRequestTotal, normalizeRoute } from '../utils/metrics.js';

/**
 * Middleware that collects HTTP request metrics.
 * Records request duration and total count with method/route/status labels.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip metrics endpoint itself to avoid recursion
  if (req.path === '/metrics') {
    return next();
  }

  const start = process.hrtime.bigint();

  // Capture the original end method to intercept response completion
  const originalEnd = res.end;
  res.end = function(this: Response, ...args: any[]) {
    const duration = Number(process.hrtime.bigint() - start) / 1e9; // Convert ns to seconds
    const route = normalizeRoute(req.route?.path || req.path);
    const statusCode = String(res.statusCode);

    httpRequestDuration.observe(
      { method: req.method, route, status_code: statusCode },
      duration
    );

    httpRequestTotal.inc({
      method: req.method,
      route,
      status_code: statusCode,
    });

    // Call the original end method
    return originalEnd.apply(this, args as any);
  } as any;

  next();
}
