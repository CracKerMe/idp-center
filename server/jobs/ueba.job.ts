import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../database.js';
import { loginEvents, userBehaviorBaselines, userGroups } from '../schema.js';
import { logger } from '../utils/logger.js';

const LOOKBACK_DAYS = 90;
const LIST_CAP = 20;

export interface UebaBaselineResult {
  usersProcessed: number;
  durationMs: number;
}

/**
 * Nightly full recompute of user_behavior_baselines from the last LOOKBACK_DAYS of
 * successful login_events (implementation plan §3.2). This is the batch counterpart to
 * risk.service.ts's updateBaseline(), which folds in one login at a time between runs —
 * this pass corrects any drift (e.g. a "usual" entry that's aged out) and fills peerGroup
 * from phase 2.3's groups instead of clustering from scratch, per the plan's explicit
 * "先按 groups 分桶，不要一上来就聚类" guidance.
 */
export async function runUebaBaselineJob(): Promise<UebaBaselineResult> {
  const start = Date.now();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      userId: loginEvents.userId,
      tenantId: loginEvents.tenantId,
      country: loginEvents.country,
      asn: loginEvents.asn,
      deviceFingerprint: loginEvents.deviceFingerprint,
      hourOfDay: loginEvents.hourOfDay,
    })
    .from(loginEvents)
    .where(and(eq(loginEvents.outcome, 'success'), gte(loginEvents.createdAt, since)));

  const byUser = new Map<string, { tenantId: string; countries: Set<string>; asns: Set<string>; devices: Set<string>; hours: Set<number>; count: number }>();

  for (const row of rows) {
    if (!row.userId) continue;
    let bucket = byUser.get(row.userId);
    if (!bucket) {
      bucket = { tenantId: row.tenantId, countries: new Set(), asns: new Set(), devices: new Set(), hours: new Set(), count: 0 };
      byUser.set(row.userId, bucket);
    }
    if (row.country) bucket.countries.add(row.country);
    if (row.asn) bucket.asns.add(row.asn);
    if (row.deviceFingerprint) bucket.devices.add(row.deviceFingerprint);
    if (row.hourOfDay != null) bucket.hours.add(row.hourOfDay);
    bucket.count += 1;
  }

  const peerGroups = await loadPeerGroups([...byUser.keys()]);

  let processed = 0;
  for (const [userId, bucket] of byUser) {
    const values = {
      userId,
      tenantId: bucket.tenantId,
      usualCountries: JSON.stringify([...bucket.countries].slice(-LIST_CAP)),
      usualAsns: JSON.stringify([...bucket.asns].slice(-LIST_CAP)),
      usualDevices: JSON.stringify([...bucket.devices].slice(-LIST_CAP)),
      usualHours: JSON.stringify([...bucket.hours]),
      loginCount: bucket.count,
      peerGroup: peerGroups.get(userId) || null,
      updatedAt: new Date(),
    };

    await db.insert(userBehaviorBaselines).values(values).onConflictDoUpdate({
      target: userBehaviorBaselines.userId,
      set: values,
    });
    processed += 1;
  }

  const durationMs = Date.now() - start;
  logger.info(`UEBA baseline recompute: ${processed} user(s) in ${durationMs}ms`);
  return { usersProcessed: processed, durationMs };
}

/** First group each user belongs to (phase 2.3 groups), used as the peer-group bucket. */
async function loadPeerGroups(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: userGroups.userId, groupId: userGroups.groupId })
    .from(userGroups)
    .where(inArray(userGroups.userId, userIds));

  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.userId)) map.set(row.userId, row.groupId);
  }
  return map;
}
