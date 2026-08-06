import crypto from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../database.js';
import {
  users,
  tenants,
  roles,
  permissions,
  rolePermissions,
  groups,
  userRoles,
  userGroups,
  groupRoles,
} from '../schema.js';

export const TENANT_ADMIN_ROLE_NAME = 'tenant-admin';

/** Global permission catalog. Codes ending in ':*' are wildcards matched by prefix. */
const SYSTEM_PERMISSIONS: { code: string; description: string }[] = [
  { code: 'admin:*', description: 'Full administrative access within a tenant' },
  { code: 'admin:users:read', description: 'View users' },
  { code: 'admin:users:write', description: 'Create/update/deactivate users' },
  { code: 'admin:clients:read', description: 'View OAuth clients' },
  { code: 'admin:clients:write', description: 'Manage OAuth clients' },
  { code: 'admin:audit:read', description: 'View audit logs' },
  { code: 'admin:sessions:write', description: 'View/revoke sessions' },
  { code: 'scim:read', description: 'SCIM read access' },
  { code: 'scim:write', description: 'SCIM write access' },
];

export async function ensureSystemPermissions(): Promise<void> {
  for (const p of SYSTEM_PERMISSIONS) {
    const [existing] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.code, p.code)).limit(1);
    if (existing) continue;
    await db.insert(permissions).values({ id: crypto.randomUUID(), code: p.code, description: p.description }).onConflictDoNothing();
  }
}

/** Idempotently creates (or returns) the system 'tenant-admin' role for a tenant, wired to admin:*. */
export async function ensureTenantAdminRole(tenantId: string): Promise<string> {
  const [existing] = await db.select({ id: roles.id }).from(roles).where(and(
    eq(roles.tenantId, tenantId),
    eq(roles.name, TENANT_ADMIN_ROLE_NAME),
  )).limit(1);
  if (existing) return existing.id;

  const roleId = crypto.randomUUID();
  await db.insert(roles).values({
    id: roleId,
    tenantId,
    name: TENANT_ADMIN_ROLE_NAME,
    description: 'Full administrative access within this tenant',
    isSystem: true,
  }).onConflictDoNothing();

  const [{ id: roleRowId } = { id: roleId }] = await db.select({ id: roles.id }).from(roles).where(and(
    eq(roles.tenantId, tenantId),
    eq(roles.name, TENANT_ADMIN_ROLE_NAME),
  )).limit(1);

  const [adminPerm] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.code, 'admin:*')).limit(1);
  if (adminPerm) {
    await db.insert(rolePermissions).values({ roleId: roleRowId, permissionId: adminPerm.id }).onConflictDoNothing();
  }

  return roleRowId;
}

export async function assignRoleToUser(userId: string, roleId: string, tenantId: string): Promise<void> {
  await db.insert(userRoles).values({ userId, roleId, tenantId }).onConflictDoNothing();
}

export async function removeRoleFromUser(userId: string, roleId: string): Promise<void> {
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
}

/**
 * Backfills users.is_admin=true into an explicit tenant-admin role assignment, idempotently.
 * Called once from initDatabase() on every startup — is_admin stays the source of truth for
 * one release window (plan §2.3); server/middleware/auth.ts checks both.
 */
export async function migrateLegacyAdminsToRoles(): Promise<number> {
  await ensureSystemPermissions();

  const allTenants = await db.select({ id: tenants.id }).from(tenants);
  const roleIdByTenant = new Map<string, string>();
  for (const t of allTenants) {
    // Startup migration racing a concurrent tenant deletion (e.g. parallel test workers
    // tearing down a short-lived tenant) is expected to occasionally lose that race —
    // skip the tenant rather than aborting the whole backfill for every other tenant.
    try {
      roleIdByTenant.set(t.id, await ensureTenantAdminRole(t.id));
    } catch {
      continue;
    }
  }

  const admins = await db.select({ id: users.id, tenantId: users.tenantId }).from(users).where(eq(users.isAdmin, true));
  let migrated = 0;
  for (const u of admins) {
    const tenantId = u.tenantId || 'default';
    const roleId = roleIdByTenant.get(tenantId);
    if (!roleId) continue;
    const [existing] = await db.select({ userId: userRoles.userId }).from(userRoles).where(and(
      eq(userRoles.userId, u.id),
      eq(userRoles.roleId, roleId),
    )).limit(1);
    if (existing) continue;
    try {
      await assignRoleToUser(u.id, roleId, tenantId);
    } catch {
      continue;
    }
    migrated++;
  }
  return migrated;
}

/** All permission codes granted to a user within a tenant, via direct roles or group membership. */
export async function getUserPermissionCodes(userId: string, tenantId: string): Promise<string[]> {
  const directRoleIds = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(and(
    eq(userRoles.userId, userId),
    eq(userRoles.tenantId, tenantId),
  ));

  const userGroupIds = await db.select({ groupId: userGroups.groupId }).from(userGroups).where(eq(userGroups.userId, userId));
  let groupRoleIds: { roleId: string }[] = [];
  if (userGroupIds.length > 0) {
    const tenantGroupIds = (await db.select({ id: groups.id }).from(groups).where(and(
      inArray(groups.id, userGroupIds.map(g => g.groupId)),
      eq(groups.tenantId, tenantId),
    ))).map(g => g.id);
    if (tenantGroupIds.length > 0) {
      groupRoleIds = await db.select({ roleId: groupRoles.roleId }).from(groupRoles).where(inArray(groupRoles.groupId, tenantGroupIds));
    }
  }

  const roleIds = [...new Set([...directRoleIds.map(r => r.roleId), ...groupRoleIds.map(r => r.roleId)])];
  if (roleIds.length === 0) return [];

  const perms = await db.select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(inArray(rolePermissions.roleId, roleIds));

  return [...new Set(perms.map(p => p.code))];
}

/** Wildcard-aware check: 'admin:*' satisfies 'admin:users:read', etc. */
export function permissionCodesSatisfy(codes: string[], required: string): boolean {
  for (const code of codes) {
    if (code === required) return true;
    if (code.endsWith(':*')) {
      const prefix = code.slice(0, -1); // keep trailing ':'
      if (required.startsWith(prefix)) return true;
    }
  }
  return false;
}

export async function userHasPermission(userId: string, tenantId: string, required: string): Promise<boolean> {
  const codes = await getUserPermissionCodes(userId, tenantId);
  return permissionCodesSatisfy(codes, required);
}

export async function getUserRoleNames(userId: string, tenantId: string): Promise<string[]> {
  const rows = await db.select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));
  return rows.map(r => r.name);
}

export async function getUserGroupNames(userId: string, tenantId: string): Promise<string[]> {
  const rows = await db.select({ name: groups.name })
    .from(userGroups)
    .innerJoin(groups, eq(userGroups.groupId, groups.id))
    .where(and(eq(userGroups.userId, userId), eq(groups.tenantId, tenantId)));
  return rows.map(r => r.name);
}
