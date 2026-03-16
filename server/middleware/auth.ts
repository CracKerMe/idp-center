import express from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database.js';
import { config } from '../config.js';

export function authenticateToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, config.JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(401);

    const tokenRecord: any = db.prepare('SELECT revoked FROM access_tokens WHERE token = ?').get(token);
    if (tokenRecord && tokenRecord.revoked === 1) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    const dbUser: any = db.prepare('SELECT is_active FROM users WHERE id = ?').get(user.id);
    if (!dbUser || !dbUser.is_active) {
      return res.status(403).json({ error: 'ACCOUNT_DISABLED' });
    }

    (req as any).user = user;
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
    if (!user.is_admin) return res.sendStatus(403);
    next();
  });
}
