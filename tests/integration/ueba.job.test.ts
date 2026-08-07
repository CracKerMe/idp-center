import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { db, initDatabase } from '../../server/database.js';
import { eq, inArray } from 'drizzle-orm';
import { users, loginEvents, userBehaviorBaselines, groups, userGroups } from '../../server/schema.js';
import { runUebaBaselineJob } from '../../server/jobs/ueba.job.js';
import crypto from 'crypto';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

describe.skipIf(skipIfNoDb)('runUebaBaselineJob', () => {
  let userId: string;
  const username = 'ueba_test_user';

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(async () => {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (existing.length > 0) {
      const ids = existing.map((u) => u.id);
      await db.delete(userBehaviorBaselines).where(inArray(userBehaviorBaselines.userId, ids));
      await db.delete(loginEvents).where(inArray(loginEvents.userId, ids));
      await db.delete(userGroups).where(inArray(userGroups.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
    const [user] = await db.insert(users).values({
      id: crypto.randomUUID(),
      username,
      email: `${username}@example.com`,
      passwordHash: 'x',
    }).returning();
    userId = user.id;
  });

  it('buckets a user\'s successful logins into deduplicated countries/asns/devices/hours', async () => {
    const now = new Date();
    await db.insert(loginEvents).values([
      { id: crypto.randomUUID(), userId, tenantId: 'default', outcome: 'success', country: 'US', asn: 'AS1', deviceFingerprint: 'dev-a', hourOfDay: 9, createdAt: now },
      { id: crypto.randomUUID(), userId, tenantId: 'default', outcome: 'success', country: 'US', asn: 'AS1', deviceFingerprint: 'dev-a', hourOfDay: 9, createdAt: now },
      { id: crypto.randomUUID(), userId, tenantId: 'default', outcome: 'success', country: 'CA', asn: 'AS2', deviceFingerprint: 'dev-b', hourOfDay: 14, createdAt: now },
      // A failed login must not contribute to the "usual" baseline.
      { id: crypto.randomUUID(), userId, tenantId: 'default', outcome: 'fail', country: 'RU', asn: 'AS9', deviceFingerprint: 'dev-evil', hourOfDay: 3, createdAt: now },
    ]);

    const result = await runUebaBaselineJob();
    expect(result.usersProcessed).toBeGreaterThanOrEqual(1);

    const [baseline] = await db.select().from(userBehaviorBaselines).where(eq(userBehaviorBaselines.userId, userId)).limit(1);
    expect(baseline).toBeTruthy();
    expect(baseline.loginCount).toBe(3); // only successful events counted

    const countries = JSON.parse(baseline.usualCountries || '[]');
    const asns = JSON.parse(baseline.usualAsns || '[]');
    const devices = JSON.parse(baseline.usualDevices || '[]');
    const hours = JSON.parse(baseline.usualHours || '[]');

    expect(countries.sort()).toEqual(['CA', 'US']);
    expect(asns.sort()).toEqual(['AS1', 'AS2']);
    expect(devices.sort()).toEqual(['dev-a', 'dev-b']);
    expect(hours.sort((a: number, b: number) => a - b)).toEqual([9, 14]);
    expect(countries).not.toContain('RU');
  });

  it('fills peerGroup from the user\'s first RBAC group', async () => {
    const [group] = await db.insert(groups).values({
      id: crypto.randomUUID(),
      tenantId: 'default',
      name: `ueba-test-group-${crypto.randomUUID().slice(0, 8)}`,
    }).returning();
    await db.insert(userGroups).values({ userId, groupId: group.id });

    await db.insert(loginEvents).values({
      id: crypto.randomUUID(), userId, tenantId: 'default', outcome: 'success', country: 'US', createdAt: new Date(),
    });

    await runUebaBaselineJob();

    const [baseline] = await db.select().from(userBehaviorBaselines).where(eq(userBehaviorBaselines.userId, userId)).limit(1);
    expect(baseline.peerGroup).toBe(group.id);
  });

  it('is idempotent: re-running recomputes the same row instead of inserting a duplicate', async () => {
    await db.insert(loginEvents).values({
      id: crypto.randomUUID(), userId, tenantId: 'default', outcome: 'success', country: 'US', createdAt: new Date(),
    });

    await runUebaBaselineJob();
    await runUebaBaselineJob();

    const rows = await db.select().from(userBehaviorBaselines).where(eq(userBehaviorBaselines.userId, userId));
    expect(rows.length).toBe(1);
  });
});
