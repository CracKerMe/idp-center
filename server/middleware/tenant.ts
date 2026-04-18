import { Request, Response, NextFunction } from 'express';
import { db } from '../database.js';
import { error, ErrorCode } from '../utils/response.js';

declare global {
  namespace Express {
    interface Request {
      tenantId: string;
    }
  }
}

export function tenantContext(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.headers['x-tenant-id']?.toString() || 
                   req.query.tenant_id?.toString() || 
                   'default';

  // Verify tenant exists
  const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
  
  if (!tenant) {
    return res.status(400).json(error(`Tenant '${tenantId}' not found`, ErrorCode.RESOURCE_NOT_FOUND));
  }

  req.tenantId = tenantId;
  next();
}
