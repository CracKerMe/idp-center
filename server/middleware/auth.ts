import express from 'express';
import { db } from '../database.js';
import { verifyInternalJwt } from '../oauth/jwt.js';
import { isTokenRevoked } from '../utils/token-blacklist.js';
import { error, ErrorCode } from '../utils/response.js';
import type { JwtUserPayload } from '../types/index.js';
import '../types/express-augment.js';
import { users } from '../schema.js';
import { eq } from 'drizzle-orm';
import { verifyDpopProof } from '../oauth/dpop.js';
import { OAuthError } from '../oauth/errors.js';
import { userHasPermission, permissionCodesSatisfy } from '../services/rbac.service.js';

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

    // RFC 9449: a token issued with cnf.jkt is DPoP-bound and must never be
    // usable as a plain Bearer token — this branch is unreachable for every
    // token issued before DPoP support existed, since none of them carry cnf.
    const cnf = (decoded as any).cnf;
    if (cnf?.jkt) {
      try {
        const presentedJkt = await verifyDpopProof(req, { expectedAth: token });
        if (presentedJkt !== cnf.jkt) {
          return res.status(401).json(error('DPoP proof key does not match token binding', ErrorCode.TOKEN_INVALID));
        }
      } catch (err) {
        const description = err instanceof OAuthError ? err.error_description : undefined;
        return res.status(401).json(error(description || 'DPoP proof required', ErrorCode.TOKEN_INVALID));
      }
    }

    if (decoded.sub_type === 'client') {
      // Machine tokens (client_credentials grant) have no user identity and
      // must never reach user-facing routes.
      return res.status(401).json(error('Machine tokens cannot access user routes', ErrorCode.TOKEN_INVALID));
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

/**
 * Check whether a user has admin privileges (platform admin, legacy admin flag,
 * or an 'admin:*' permission grant via roles/groups). Always reads from DB so
 * demotions take effect immediately.
 *
 * Shared by authenticateAdmin and the SSE endpoint to keep admin gating consistent.
 */
export async function isUserAdmin(userId: string, tenantId: string): Promise<boolean> {
  const [dbUser] = await db.select({ isAdmin: users.isAdmin, isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, userId)).limit(1);
  if (dbUser?.isPlatformAdmin || dbUser?.isAdmin) return true;
  return userHasPermission(userId, tenantId, 'admin:*');
}

/**
 * Tenant-scoped admin check. `is_admin` (legacy) and `is_platform_admin` both short-circuit;
 * everyone else needs an 'admin:*' permission grant scoped to req.tenantId via roles/groups.
 * Always re-reads from the DB rather than trusting the JWT's `is_admin` claim, so a demoted
 * admin loses access immediately instead of waiting for their access token to expire.
 */
export async function authenticateAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  authenticateToken(req, res, async () => {
    try {
      const [dbUser] = await db.select({ isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, req.user!.id)).limit(1);
      req.isPlatformAdmin = dbUser?.isPlatformAdmin ?? false;

      const tenantId = req.tenantId || req.user!.tenant_id || 'default';
      if (await isUserAdmin(req.user!.id, tenantId)) return next();

      return res.status(403).json(error('Admin access required', ErrorCode.AUTH_UNAUTHORIZED));
    } catch (err) {
      next(err);
    }
  });
}

/** Cross-tenant operations (tenant CRUD, global stats, global maintenance) — is_platform_admin only. */
export async function authenticatePlatformAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  authenticateToken(req, res, async () => {
    try {
      const [dbUser] = await db.select({ isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, req.user!.id)).limit(1);
      if (!dbUser?.isPlatformAdmin) {
        return res.status(403).json(error('Platform admin access required', ErrorCode.AUTH_UNAUTHORIZED));
      }
      req.isPlatformAdmin = true;
      next();
    } catch (err) {
      next(err);
    }
  });
}

/** Fine-grained RBAC gate for a specific permission code, scoped to req.tenantId. */
export function requirePermission(code: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    authenticateToken(req, res, async () => {
      try {
        const [dbUser] = await db.select({ isAdmin: users.isAdmin, isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, req.user!.id)).limit(1);
        if (dbUser?.isPlatformAdmin) return next();
        if (dbUser?.isAdmin && permissionCodesSatisfy(['admin:*'], code)) return next();

        const tenantId = req.tenantId || req.user!.tenant_id || 'default';
        const allowed = await userHasPermission(req.user!.id, tenantId, code);
        if (allowed) return next();

        return res.status(403).json(error('Forbidden', ErrorCode.AUTH_UNAUTHORIZED));
      } catch (err) {
        next(err);
      }
    });
  };
}
