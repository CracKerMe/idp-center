import express from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../database.js';
import { users } from '../../schema.js';
import { error, ErrorCode } from '../../utils/response.js';

/**
 * Guards the :tenantId path param on per-tenant admin sub-resources (password policy,
 * IP whitelist). Without this a tenant-admin could manage another tenant's policy just
 * by knowing its id — req.tenantId (from X-Tenant-ID) was never cross-checked against it.
 */
export function requireOwnTenantOrPlatformAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.isPlatformAdmin || req.params.tenantId === req.tenantId) return next();
  return res.status(403).json(error('Cannot manage another tenant', ErrorCode.AUTH_UNAUTHORIZED));
}

/**
 * Loads a user by id, but only if it belongs to the caller's tenant (unless the
 * caller is a platform-admin). Returns null both when the user doesn't exist and
 * when it belongs to another tenant — callers respond 404 either way so tenant
 * boundaries aren't leaked through a distinguishable error.
 */
export async function findUserInScope(req: express.Request, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  if (!req.isPlatformAdmin && user.tenantId !== req.tenantId) return null;
  return user;
}
