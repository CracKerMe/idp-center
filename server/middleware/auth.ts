import express from 'express';
import { db } from '../database.js';
import { verifyInternalJwt } from '../oauth/jwt.js';
import { isTokenRevoked } from '../utils/token-blacklist.js';
import { error, ErrorCode } from '../utils/response.js';
import type { JwtUserPayload } from '../types/index.js';
import '../types/express-augment.js';
import { users } from '../schema.js';
import { eq } from 'drizzle-orm';

export async function authenticateToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.status(401).json(error('Authorization required', ErrorCode.AUTH_UNAUTHORIZED));

    let decoded;
    try {
      decoded = await verifyInternalJwt(token);
    } catch {
      return res.status(401).json(error('Invalid token', ErrorCode.TOKEN_INVALID));
    }

    if (typeof decoded.id !== 'string' || typeof decoded.username !== 'string') {
      return res.status(401).json(error('Invalid token payload', ErrorCode.TOKEN_INVALID));
    }

    const user = decoded as unknown as JwtUserPayload;

    const revoked = await isTokenRevoked(token);
    if (revoked) {
      return res.status(401).json(error('Token has been revoked', ErrorCode.TOKEN_REVOKED));
    }

    const [dbUser] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, user.id)).limit(1);
    if (!dbUser || !dbUser.isActive) {
      return res.status(403).json(error('Account is disabled', ErrorCode.ACCOUNT_DISABLED));
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

export function authenticateAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  authenticateToken(req, res, () => {
    if (!req.user?.is_admin) return res.status(403).json(error('Admin access required', ErrorCode.AUTH_UNAUTHORIZED));
    next();
  });
}
