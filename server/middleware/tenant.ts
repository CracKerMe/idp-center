import { Request, Response, NextFunction } from 'express';
import { db } from '../database.js';
import { error, ErrorCode } from '../utils/response.js';
import { tenants } from '../schema.js';
import { eq } from 'drizzle-orm';

declare global {
  namespace Express {
    interface Request {
      tenantId: string;
    }
  }
}

export async function tenantContext(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.headers['x-tenant-id']?.toString() ||
                     req.query.tenant_id?.toString() ||
                     'default';

    const [tenant] = await db.select({ id: tenants.id, isActive: tenants.isActive }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

    if (!tenant) {
      return res.status(400).json(error(`Tenant '${tenantId}' not found`, ErrorCode.RESOURCE_NOT_FOUND));
    }
    if (!tenant.isActive) {
      return res.status(403).json(error(`Tenant '${tenantId}' is disabled`, ErrorCode.ACCOUNT_DISABLED));
    }

    req.tenantId = tenantId;
    next();
  } catch (err) {
    next(err);
  }
}
