import type { JwtUserPayload } from './index.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
      token?: string;
      isPlatformAdmin?: boolean;
    }
  }
}
