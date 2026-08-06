import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const REQUEST_ID_HEADER = 'X-Request-ID';

/**
 * Middleware that ensures every request has a unique request ID.
 * 
 * - If the client sends X-Request-ID, it's reused (useful for distributed tracing)
 * - Otherwise, a new UUID is generated
 * - The ID is set on req.requestId and echoed back in the response header
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers[REQUEST_ID_HEADER.toLowerCase()] as string || randomUUID();
  req.requestId = requestId;
  
  // Echo back in response
  res.setHeader(REQUEST_ID_HEADER, requestId);
  
  next();
}
