import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { db, initDatabase } from '../../server/database.js';
import { tenants, users, accessTokens, refreshTokens, sessions, auditLogs, mfaFactors, userRoles, roles, rolePermissions } from '../../server/schema.js';
import { app } from '../../server.js';
import request from 'supertest';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

describe.skipIf(skipIfNoDb)('RBAC / tenant isolation', () => {
  const TENANT_A = 'rbac-tenant-a';
  const TENANT_B = 'rbac-tenant-b';

  // Other integration test files' beforeAll also calls initDatabase(), which runs
  // migrateLegacyAdminsToRoles() across every tenant — including this file's, while its
  // tests are mid-flight in a concurrent worker. That can insert a fresh role/user_roles
  // row between this cleanup's delete statements. Retry a few times rather than let that
  // cross-file race flake the suite; each retry's window is much smaller than the last.
  async function cleanupOnce() {
    const tenantIds = [TENANT_A, TENANT_B];
    const roleIdsSubquery = db.select({ id: roles.id }).from(roles).where(inArray(roles.tenantId, tenantIds));
    await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, roleIdsSubquery));
    await db.delete(userRoles).where(inArray(userRoles.roleId, roleIdsSubquery));
    await db.delete(roles).where(inArray(roles.tenantId, tenantIds));

    const userIds = (await db.select({ id: users.id }).from(users).where(inArray(users.tenantId, tenantIds))).map(u => u.id);
    if (userIds.length > 0) {
      await db.delete(mfaFactors).where(inArray(mfaFactors.userId, userIds));
      await db.delete(accessTokens).where(inArray(accessTokens.userId, userIds));
      await db.delete(refreshTokens).where(inArray(refreshTokens.userId, userIds));
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
    }
    await db.delete(auditLogs).where(inArray(auditLogs.tenantId, tenantIds));
    await db.delete(users).where(inArray(users.tenantId, tenantIds));
    await db.delete(tenants).where(inArray(tenants.id, tenantIds));
  }

  async function cleanup() {
    const attempts = 5;
    for (let i = 0; i < attempts; i++) {
      try {
        await cleanupOnce();
        return;
      } catch (err) {
        if (i === attempts - 1) throw err;
      }
    }
  }

  let adminAToken: string;
  let platformAdminToken: string;
  let userBId: string;

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(async () => {
    await cleanup();

    await db.insert(tenants).values([
      { id: TENANT_A, name: 'RBAC Tenant A', isActive: true },
      { id: TENANT_B, name: 'RBAC Tenant B', isActive: true },
    ]);

    const passwordHash = await bcrypt.hash('Password123!', 10);

    await db.insert(users).values({
      id: crypto.randomUUID(),
      username: 'rbac_admin_a',
      email: 'rbac_admin_a@example.com',
      passwordHash,
      tenantId: TENANT_A,
      isAdmin: true,
      emailVerified: true,
    });

    userBId = crypto.randomUUID();
    await db.insert(users).values({
      id: userBId,
      username: 'rbac_user_b',
      email: 'rbac_user_b@example.com',
      passwordHash,
      tenantId: TENANT_B,
      isAdmin: false,
      emailVerified: true,
    });

    await db.insert(users).values({
      id: crypto.randomUUID(),
      username: 'rbac_platform_admin',
      email: 'rbac_platform_admin@example.com',
      passwordHash,
      tenantId: TENANT_A,
      isAdmin: false,
      isPlatformAdmin: true,
      emailVerified: true,
    });

    await db.insert(auditLogs).values([
      { id: crypto.randomUUID(), userId: null, tenantId: TENANT_A, action: 'RBAC_TEST_EVENT_A' },
      { id: crypto.randomUUID(), userId: null, tenantId: TENANT_B, action: 'RBAC_TEST_EVENT_B' },
    ]);

    const loginA = await request(app)
      .post('/api/auth/login')
      .set('X-Tenant-ID', TENANT_A)
      .send({ username: 'rbac_admin_a', password: 'Password123!' });
    adminAToken = loginA.body.data.access_token;

    const loginPlatform = await request(app)
      .post('/api/auth/login')
      .set('X-Tenant-ID', TENANT_A)
      .send({ username: 'rbac_platform_admin', password: 'Password123!' });
    platformAdminToken = loginPlatform.body.data.access_token;
  });

  it('scopes GET /api/admin/users to the caller tenant, ignoring a foreign tenant_id query param', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('X-Tenant-ID', TENANT_A)
      .set('Authorization', `Bearer ${adminAToken}`)
      .query({ tenant_id: TENANT_B, pageSize: 100 });

    expect(res.status).toBe(200);
    const usernames = res.body.data.items.map((u: any) => u.username);
    expect(usernames).not.toContain('rbac_user_b');
  });

  it('returns 404 (not leaking existence) when a tenant-admin targets another tenant\'s user', async () => {
    const res = await request(app)
      .put(`/api/admin/users/${userBId}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ full_name: 'Hijacked' });

    expect(res.status).toBe(404);

    const [stillUnchanged] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userBId)).limit(1);
    expect(stillUnchanged?.fullName).not.toBe('Hijacked');
  });

  it('rejects a tenant-admin banning a user in another tenant', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${userBId}/ban`)
      .set('X-Tenant-ID', TENANT_A)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(404);

    const [stillActive] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, userBId)).limit(1);
    expect(stillActive?.isActive).toBe(true);
  });

  it('scopes GET /api/admin/audit to the caller tenant', async () => {
    const res = await request(app)
      .get('/api/admin/audit')
      .set('X-Tenant-ID', TENANT_A)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(200);
    const tenantIds = res.body.data.items.map((l: any) => l.tenantId);
    expect(tenantIds.every((t: string) => t === TENANT_A)).toBe(true);
    const actions = res.body.data.items.map((l: any) => l.action);
    expect(actions).not.toContain('RBAC_TEST_EVENT_B');
  });

  it('denies a tenant-admin the platform-wide GET /api/admin/tenants', async () => {
    const res = await request(app)
      .get('/api/admin/tenants')
      .set('X-Tenant-ID', TENANT_A)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(403);
  });

  it('lets a platform-admin see both tenants via GET /api/admin/tenants', async () => {
    const res = await request(app)
      .get('/api/admin/tenants')
      .set('X-Tenant-ID', TENANT_A)
      .set('Authorization', `Bearer ${platformAdminToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((t: any) => t.id);
    expect(ids).toEqual(expect.arrayContaining([TENANT_A, TENANT_B]));
  });

  it('denies a tenant-admin managing another tenant\'s password policy via the :tenantId path param', async () => {
    const res = await request(app)
      .get(`/api/admin/tenants/${TENANT_B}/password-policy`)
      .set('X-Tenant-ID', TENANT_A)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(403);
  });

  it('rejects requests scoped to a deactivated tenant', async () => {
    await db.update(tenants).set({ isActive: false }).where(eq(tenants.id, TENANT_B));

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Tenant-ID', TENANT_B)
      .send({ username: 'rbac_user_b', password: 'Password123!' });

    expect(res.status).toBe(403);
  });
});
