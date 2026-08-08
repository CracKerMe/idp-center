import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { db, initDatabase } from '../../server/database.js';
import { tenants, users, accessTokens, refreshTokens, sessions, roles, userRoles, rolePermissions } from '../../server/schema.js';
import { featureFlags } from '../../server/schema/features.js';
import { resetFeatureSnapshotForTests } from '../../server/services/feature.service.js';
import { app } from '../../server.js';
import request from 'supertest';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

describe.skipIf(skipIfNoDb)('Admin feature-flags API (integration)', () => {
  const TENANT = 'features-admin-tenant';
  let adminToken: string;
  let platformAdminToken: string;

  async function cleanupUsers() {
    const userIds = (await db.select({ id: users.id }).from(users).where(eq(users.tenantId, TENANT))).map(u => u.id);
    if (userIds.length > 0) {
      await db.delete(accessTokens).where(inArray(accessTokens.userId, userIds));
      await db.delete(refreshTokens).where(inArray(refreshTokens.userId, userIds));
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      // Clean up role assignments referencing these users before deleting users
      await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
    }
    // Clean up roles referencing this tenant before deleting tenant
    const roleIdsSubquery = db.select({ id: roles.id }).from(roles).where(eq(roles.tenantId, TENANT));
    await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, roleIdsSubquery));
    await db.delete(roles).where(eq(roles.tenantId, TENANT));
    await db.delete(users).where(eq(users.tenantId, TENANT));
    await db.delete(tenants).where(eq(tenants.id, TENANT));
  }

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(async () => {
    await cleanupUsers();
    // Clean all feature flag rows to ensure full isolation between tests
    await db.delete(featureFlags);
    resetFeatureSnapshotForTests();

    await db.insert(tenants).values({ id: TENANT, name: 'Features Admin Tenant', isActive: true });

    const passwordHash = await bcrypt.hash('Password123!', 10);
    await db.insert(users).values({
      id: crypto.randomUUID(),
      username: 'features_tenant_admin',
      email: 'features_tenant_admin@example.com',
      passwordHash,
      tenantId: TENANT,
      isAdmin: true,
      emailVerified: true,
    });
    await db.insert(users).values({
      id: crypto.randomUUID(),
      username: 'features_platform_admin',
      email: 'features_platform_admin@example.com',
      passwordHash,
      tenantId: TENANT,
      isAdmin: false,
      isPlatformAdmin: true,
      emailVerified: true,
    });

    const loginTenant = await request(app).post('/api/auth/login').set('X-Tenant-ID', TENANT)
      .send({ username: 'features_tenant_admin', password: 'Password123!' });
    adminToken = loginTenant.body.data.access_token;

    const loginPlatform = await request(app).post('/api/auth/login').set('X-Tenant-ID', TENANT)
      .send({ username: 'features_platform_admin', password: 'Password123!' });
    platformAdminToken = loginPlatform.body.data.access_token;
  });

  afterAll(async () => {
    await cleanupUsers();
    await db.delete(featureFlags);
    resetFeatureSnapshotForTests();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/features');
    expect(res.status).toBe(401);
  });

  it('rejects a tenant admin who is not a platform admin', async () => {
    const res = await request(app).get('/api/admin/features')
      .set('X-Tenant-ID', TENANT).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  it('lists the full registry for a platform admin', async () => {
    const res = await request(app).get('/api/admin/features')
      .set('X-Tenant-ID', TENANT).set('Authorization', `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const keys = res.body.data.map((f: any) => f.key);
    expect(keys).toContain('deviceFlow');
    expect(keys).toContain('riskEngine');
  });

  it('returns 404 for an unknown key', async () => {
    const res = await request(app).put('/api/admin/features/notARealFlag')
      .set('X-Tenant-ID', TENANT).set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ value: true });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid enum value', async () => {
    const res = await request(app).put('/api/admin/features/riskEngine')
      .set('X-Tenant-ID', TENANT).set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ value: 'bogus-mode' });
    expect(res.status).toBe(400);
  });

  it('toggling deviceFlow off immediately 404s the device_authorization route, and reset restores it', async () => {
    const before = await request(app).post('/api/oidc/device_authorization').send({});
    expect(before.status).not.toBe(404);

    const put = await request(app).put('/api/admin/features/deviceFlow')
      .set('X-Tenant-ID', TENANT).set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ value: false });
    expect(put.status).toBe(200);
    expect(put.body.data.value).toBe(false);

    const during = await request(app).post('/api/oidc/device_authorization').send({});
    expect(during.status).toBe(404);

    const reset = await request(app).post('/api/admin/features/reset/deviceFlow')
      .set('X-Tenant-ID', TENANT).set('Authorization', `Bearer ${platformAdminToken}`);
    expect(reset.status).toBe(200);

    const after = await request(app).post('/api/oidc/device_authorization').send({});
    expect(after.status).not.toBe(404);
  });
});
