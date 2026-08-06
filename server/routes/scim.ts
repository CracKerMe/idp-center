import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { and, eq, or, ilike, count } from 'drizzle-orm';
import { db } from '../database.js';
import { config } from '../config.js';
import { verifyInternalJwt } from '../oauth/jwt.js';
import { isTokenRevoked } from '../utils/token-blacklist.js';
import { users, groups, userGroups } from '../schema.js';
import { logAudit } from '../utils/audit.js';
import { AuditAction } from '../utils/audit-actions.js';
import { scimOperations } from '../utils/metrics.js';

const router = express.Router();

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

function scimError(res: express.Response, status: number, detail: string) {
  res.status(status).json({ schemas: [SCIM_ERROR_SCHEMA], detail, status: String(status) });
}

/**
 * SCIM has no OAuth-flow endpoint of its own — clients authenticate with a normal
 * client_credentials access token carrying a scim:* scope (see clients.allowed_scopes).
 * The token's tenant_id becomes req.tenantId: SCIM is inherently per-tenant, one
 * provisioning connector per IdP-side tenant, so there's no header to trust instead.
 */
function requireScimScope(requiredScope: 'scim:read' | 'scim:write') {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return scimError(res, 401, 'Authorization required');

    let payload: any;
    try {
      payload = await verifyInternalJwt(token);
    } catch {
      return scimError(res, 401, 'Invalid token');
    }

    if (payload.sub_type !== 'client') return scimError(res, 401, 'SCIM requires a client_credentials token');
    if (await isTokenRevoked(token)) return scimError(res, 401, 'Token has been revoked');

    const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
    // scim:write implies scim:read.
    if (!scopes.includes(requiredScope) && !(requiredScope === 'scim:read' && scopes.includes('scim:write'))) {
      return scimError(res, 403, `Missing required scope: ${requiredScope}`);
    }

    req.tenantId = payload.tenant_id as string;
    (req as any).scimClientId = payload.client_id;
    next();
  };
}

function userToScim(u: typeof users.$inferSelect) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: u.id,
    userName: u.username,
    name: { formatted: u.fullName || u.username },
    emails: [{ value: u.email, primary: true }],
    active: !!u.isActive,
    meta: {
      resourceType: 'User',
      created: u.createdAt,
      lastModified: u.updatedAt,
      location: `${config.APP_URL}/scim/v2/Users/${u.id}`,
    },
  };
}

async function groupToScim(g: typeof groups.$inferSelect) {
  const members = await db.select({ id: userGroups.userId, username: users.username })
    .from(userGroups)
    .innerJoin(users, eq(userGroups.userId, users.id))
    .where(eq(userGroups.groupId, g.id));

  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: g.id,
    displayName: g.name,
    members: members.map(m => ({ value: m.id, display: m.username })),
    meta: {
      resourceType: 'Group',
      created: g.createdAt,
      location: `${config.APP_URL}/scim/v2/Groups/${g.id}`,
    },
  };
}

function parsePaging(req: express.Request): { startIndex: number; count: number } {
  const startIndex = Math.max(1, parseInt(String(req.query.startIndex ?? '1'), 10) || 1);
  const count = Math.min(200, Math.max(1, parseInt(String(req.query.count ?? '100'), 10) || 100));
  return { startIndex, count };
}

/** Supports the common single-clause filters SCIM clients (Okta/Azure AD) actually send. */
function parseUserFilter(filter: string | undefined) {
  if (!filter) return undefined;
  const m = filter.match(/^(userName|emails(?:\.value)?)\s+eq\s+"([^"]*)"$/i);
  if (!m) return undefined;
  const [, attr, value] = m;
  return attr.toLowerCase().startsWith('username') ? eq(users.username, value) : eq(users.email, value);
}

// GET /scim/v2/ServiceProviderConfig
router.get('/ServiceProviderConfig', requireScimScope('scim:read'), (_req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{
      type: 'oauthbearertoken',
      name: 'OAuth Bearer Token',
      description: 'Authenticate using a client_credentials access token with a scim:* scope',
    }],
  });
});

// GET /scim/v2/Users
router.get('/Users', requireScimScope('scim:read'), async (req, res) => {
  const { startIndex, count: pageSize } = parsePaging(req);
  const filterCond = parseUserFilter(typeof req.query.filter === 'string' ? req.query.filter : undefined);
  const where = filterCond ? and(eq(users.tenantId, req.tenantId), filterCond) : eq(users.tenantId, req.tenantId);

  const [{ total }] = await db.select({ total: count() }).from(users).where(where);
  const rows = await db.select().from(users).where(where).limit(pageSize).offset(startIndex - 1);

  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: Number(total),
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map(userToScim),
  });
});

// POST /scim/v2/Users
router.post('/Users', requireScimScope('scim:write'), async (req, res) => {
  const body = req.body || {};
  const userName = body.userName;
  const email = body.emails?.[0]?.value || body.emails?.find?.((e: any) => e.primary)?.value;
  if (!userName || !email) return scimError(res, 400, 'userName and emails[0].value are required');

  const randomPassword = crypto.randomBytes(24).toString('hex');
  const passwordHash = await bcrypt.hash(randomPassword, 10);
  const id = crypto.randomUUID();

  try {
    await db.insert(users).values({
      id,
      username: userName,
      email,
      passwordHash,
      fullName: body.name?.formatted || null,
      tenantId: req.tenantId,
      isActive: body.active !== false,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });
  } catch (err: any) {
    if (err.message?.includes('duplicate key')) return scimError(res, 409, 'User already exists');
    return scimError(res, 500, 'Internal server error');
  }

  const [created] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  await logAudit({ req, action: AuditAction.SCIM_USER_CREATED, details: JSON.stringify({ scim_client: (req as any).scimClientId, user_id: id }), tenantId: req.tenantId });
  scimOperations.inc({ resource: 'User', method: 'POST', status_code: '201' });
  res.status(201).json(userToScim(created));
});

// GET /scim/v2/Users/:id
router.get('/Users/:id', requireScimScope('scim:read'), async (req, res) => {
  const [u] = await db.select().from(users).where(and(eq(users.id, req.params.id), eq(users.tenantId, req.tenantId))).limit(1);
  if (!u) return scimError(res, 404, 'User not found');
  res.json(userToScim(u));
});

// PUT /scim/v2/Users/:id — full replace of mutable attributes.
router.put('/Users/:id', requireScimScope('scim:write'), async (req, res) => {
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, req.params.id), eq(users.tenantId, req.tenantId))).limit(1);
  if (!u) return scimError(res, 404, 'User not found');

  const body = req.body || {};
  const email = body.emails?.[0]?.value;
  await db.update(users).set({
    username: body.userName ?? undefined,
    email: email ?? undefined,
    fullName: body.name?.formatted ?? undefined,
    isActive: body.active !== undefined ? !!body.active : undefined,
    updatedAt: new Date(),
  }).where(eq(users.id, req.params.id));

  const [updated] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
  await logAudit({ req, action: AuditAction.SCIM_USER_UPDATED, details: JSON.stringify({ scim_client: (req as any).scimClientId, user_id: req.params.id }), tenantId: req.tenantId });
  res.json(userToScim(updated));
});

// PATCH /scim/v2/Users/:id — supports the common {op, path, value} shape (RFC 7644 §3.5.2).
router.patch('/Users/:id', requireScimScope('scim:write'), async (req, res) => {
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, req.params.id), eq(users.tenantId, req.tenantId))).limit(1);
  if (!u) return scimError(res, 404, 'User not found');

  const ops: any[] = req.body?.Operations || [];
  const updateData: Record<string, any> = {};

  for (const op of ops) {
    const opName = String(op.op || '').toLowerCase();
    if (opName !== 'replace' && opName !== 'add') continue;

    if (op.path === 'active' || (!op.path && typeof op.value?.active === 'boolean')) {
      updateData.isActive = op.path ? !!op.value : !!op.value.active;
    }
    if (op.path === 'userName' || (!op.path && op.value?.userName)) {
      updateData.username = op.path ? op.value : op.value.userName;
    }
    if (op.path === 'name.formatted' || (!op.path && op.value?.name?.formatted)) {
      updateData.fullName = op.path ? op.value : op.value.name.formatted;
    }
  }

  if (Object.keys(updateData).length > 0) {
    updateData.updatedAt = new Date();
    await db.update(users).set(updateData).where(eq(users.id, req.params.id));
  }

  const [updated] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
  await logAudit({ req, action: AuditAction.SCIM_USER_PATCHED, details: JSON.stringify({ scim_client: (req as any).scimClientId, user_id: req.params.id }), tenantId: req.tenantId });
  res.json(userToScim(updated));
});

// DELETE /scim/v2/Users/:id — deactivates rather than hard-deletes, consistent with the
// rest of the system (server/routes/admin.ts does the same for admin-initiated deletes).
router.delete('/Users/:id', requireScimScope('scim:write'), async (req, res) => {
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, req.params.id), eq(users.tenantId, req.tenantId))).limit(1);
  if (!u) return scimError(res, 404, 'User not found');

  await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, req.params.id));
  await logAudit({ req, action: AuditAction.SCIM_USER_DEACTIVATED, details: JSON.stringify({ scim_client: (req as any).scimClientId, user_id: req.params.id }), tenantId: req.tenantId });
  res.status(204).send();
});

// GET /scim/v2/Groups
router.get('/Groups', requireScimScope('scim:read'), async (req, res) => {
  const { startIndex, count: pageSize } = parsePaging(req);
  const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
  const nameMatch = filter?.match(/^displayName\s+eq\s+"([^"]*)"$/i);
  const where = nameMatch ? and(eq(groups.tenantId, req.tenantId), eq(groups.name, nameMatch[1])) : eq(groups.tenantId, req.tenantId);

  const [{ total }] = await db.select({ total: count() }).from(groups).where(where);
  const rows = await db.select().from(groups).where(where).limit(pageSize).offset(startIndex - 1);

  res.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: Number(total),
    startIndex,
    itemsPerPage: rows.length,
    Resources: await Promise.all(rows.map(groupToScim)),
  });
});

// POST /scim/v2/Groups
router.post('/Groups', requireScimScope('scim:write'), async (req, res) => {
  const displayName = req.body?.displayName;
  if (!displayName) return scimError(res, 400, 'displayName is required');

  const id = crypto.randomUUID();
  try {
    await db.insert(groups).values({ id, tenantId: req.tenantId, name: displayName });
  } catch (err: any) {
    if (err.message?.includes('duplicate key')) return scimError(res, 409, 'Group already exists');
    return scimError(res, 500, 'Internal server error');
  }

  const members: any[] = req.body?.members || [];
  for (const m of members) {
    if (m.value) await db.insert(userGroups).values({ userId: m.value, groupId: id }).onConflictDoNothing();
  }

  const [created] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  await logAudit({ req, action: AuditAction.SCIM_GROUP_CREATED, details: JSON.stringify({ scim_client: (req as any).scimClientId, group_id: id }), tenantId: req.tenantId });
  scimOperations.inc({ resource: 'Group', method: 'POST', status_code: '201' });
  res.status(201).json(await groupToScim(created));
});

// GET /scim/v2/Groups/:id
router.get('/Groups/:id', requireScimScope('scim:read'), async (req, res) => {
  const [g] = await db.select().from(groups).where(and(eq(groups.id, req.params.id), eq(groups.tenantId, req.tenantId))).limit(1);
  if (!g) return scimError(res, 404, 'Group not found');
  res.json(await groupToScim(g));
});

// PUT /scim/v2/Groups/:id — replaces displayName and the full member set.
router.put('/Groups/:id', requireScimScope('scim:write'), async (req, res) => {
  const [g] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, req.params.id), eq(groups.tenantId, req.tenantId))).limit(1);
  if (!g) return scimError(res, 404, 'Group not found');

  if (req.body?.displayName) {
    await db.update(groups).set({ name: req.body.displayName }).where(eq(groups.id, req.params.id));
  }
  if (Array.isArray(req.body?.members)) {
    await db.delete(userGroups).where(eq(userGroups.groupId, req.params.id));
    for (const m of req.body.members) {
      if (m.value) await db.insert(userGroups).values({ userId: m.value, groupId: req.params.id }).onConflictDoNothing();
    }
  }

  const [updated] = await db.select().from(groups).where(eq(groups.id, req.params.id)).limit(1);
  await logAudit({ req, action: AuditAction.SCIM_GROUP_UPDATED, details: JSON.stringify({ scim_client: (req as any).scimClientId, group_id: req.params.id }), tenantId: req.tenantId });
  res.json(await groupToScim(updated));
});

// PATCH /scim/v2/Groups/:id — supports add/remove member operations on the "members" path.
router.patch('/Groups/:id', requireScimScope('scim:write'), async (req, res) => {
  const [g] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, req.params.id), eq(groups.tenantId, req.tenantId))).limit(1);
  if (!g) return scimError(res, 404, 'Group not found');

  const ops: any[] = req.body?.Operations || [];
  for (const op of ops) {
    const opName = String(op.op || '').toLowerCase();
    const path = String(op.path || '').toLowerCase();
    if (path !== 'members') continue;

    const values: any[] = Array.isArray(op.value) ? op.value : (op.value ? [op.value] : []);
    if (opName === 'add') {
      for (const v of values) {
        if (v.value) await db.insert(userGroups).values({ userId: v.value, groupId: req.params.id }).onConflictDoNothing();
      }
    } else if (opName === 'remove') {
      for (const v of values) {
        if (v.value) await db.delete(userGroups).where(and(eq(userGroups.groupId, req.params.id), eq(userGroups.userId, v.value)));
      }
    }
  }

  const [updated] = await db.select().from(groups).where(eq(groups.id, req.params.id)).limit(1);
  await logAudit({ req, action: AuditAction.SCIM_GROUP_PATCHED, details: JSON.stringify({ scim_client: (req as any).scimClientId, group_id: req.params.id }), tenantId: req.tenantId });
  res.json(await groupToScim(updated));
});

// DELETE /scim/v2/Groups/:id
router.delete('/Groups/:id', requireScimScope('scim:write'), async (req, res) => {
  const [g] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, req.params.id), eq(groups.tenantId, req.tenantId))).limit(1);
  if (!g) return scimError(res, 404, 'Group not found');

  await db.delete(userGroups).where(eq(userGroups.groupId, req.params.id));
  await db.delete(groups).where(eq(groups.id, req.params.id));
  await logAudit({ req, action: AuditAction.SCIM_GROUP_DELETED, details: JSON.stringify({ scim_client: (req as any).scimClientId, group_id: req.params.id }), tenantId: req.tenantId });
  res.status(204).send();
});

export default router;
