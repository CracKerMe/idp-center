import express from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database.js';
import { config } from '../config.js';
import { isTokenRevoked, RevokeReason } from '../utils/token-blacklist.js';
import { error, ErrorCode } from '../utils/response.js';

export function authenticateToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.status(401).json(error('Authorization required', ErrorCode.AUTH_UNAUTHORIZED));

  jwt.verify(token, config.JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(401).json(error('Invalid token', ErrorCode.TOKEN_INVALID));

    // Check token blacklist for immediate revocation
    if (isTokenRevoked(token)) {
      return res.status(401).json(error('Token has been revoked', ErrorCode.TOKEN_REVOKED));
    }

    const dbUser: any = db.prepare('SELECT is_active FROM users WHERE id = ?').get(user.id);
    if (!dbUser || !dbUser.is_active) {
      return res.status(403).json(error('Account is disabled', ErrorCode.ACCOUNT_DISABLED));
    }

    (req as any).user = user;
    (req as any).token = token;
    next();
  });
}

export function authenticateAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  authenticateToken(req, res, () => {
    const user = (req as any).user;
    if (!user.is_admin) return res.status(403).json(error('Admin access required', ErrorCode.AUTH_UNAUTHORIZED));
    next();
  });
}
