import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../database.js';
import { featureFlags } from '../schema/features.js';
import { FEATURE_REGISTRY, type FeatureKey, type ResolvedValue, type FeatureFlagDef } from '../features/registry.js';
import { eventBus } from './event-bus.service.js';
import { logger } from '../utils/logger.js';

interface SnapshotEntry { value: unknown; source: 'db' | 'env'; }

/**
 * Synchronous, built purely from FEATURE_REGISTRY.envDefault() — this is what answers
 * isEnabled()/getValue() for any request that lands before loadFlags() resolves (mirrors
 * today's env-var-only behavior). Never undefined, never throws.
 */
function buildEnvSnapshot(): Map<FeatureKey, SnapshotEntry> {
  const m = new Map<FeatureKey, SnapshotEntry>();
  for (const key of Object.keys(FEATURE_REGISTRY) as FeatureKey[]) {
    m.set(key, { value: FEATURE_REGISTRY[key].envDefault(), source: 'env' });
  }
  return m;
}

let snapshot = buildEnvSnapshot();
let loadedOnce = false;
let resyncTimer: NodeJS.Timeout | null = null;

function clampToHardRequirement(key: FeatureKey, value: unknown): unknown {
  const def = FEATURE_REGISTRY[key] as FeatureFlagDef;
  if (def.hardRequirement && !def.hardRequirement.met() && value !== false && value !== 'off') {
    logger.warn(`feature.service: '${key}' DB override ignored — ${def.hardRequirement.reasonZh}`);
    return def.type === 'triState' ? 'off' : false;
  }
  return value;
}

async function readAllRows(): Promise<Map<FeatureKey, SnapshotEntry>> {
  const next = buildEnvSnapshot();
  const rows = await db.select().from(featureFlags);
  for (const row of rows) {
    const key = row.key as FeatureKey;
    if (!(key in FEATURE_REGISTRY)) continue; // stale row for a removed flag — never crash boot
    try {
      const parsed = JSON.parse(row.value);
      next.set(key, { value: clampToHardRequirement(key, parsed), source: 'db' });
    } catch {
      logger.warn(`feature.service: corrupt value for '${key}', using env default`);
    }
  }
  return next;
}

/** Full resync from DB. Call once at boot (before startScheduler()/first request) and by the
 *  periodic fallback timer. */
export async function loadFlags(): Promise<void> {
  snapshot = await readAllRows();
  loadedOnce = true;
}

export function isEnabled(key: FeatureKey): boolean {
  const v = snapshot.get(key)!.value;
  return v === true || v === 'enforce';
}

export function getValue<K extends FeatureKey>(key: K): ResolvedValue<K> {
  return snapshot.get(key)!.value as ResolvedValue<K>;
}

export function getSource(key: FeatureKey): 'db' | 'env' {
  return snapshot.get(key)!.source;
}

export function isLoaded(): boolean {
  return loadedOnce;
}

export function listResolved() {
  return (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).map(key => ({
    key,
    def: FEATURE_REGISTRY[key] as FeatureFlagDef,
    value: getValue(key),
    source: getSource(key),
  }));
}

export class DependencyViolationError extends Error {}
export class InvalidFeatureValueError extends Error {}

function assertValueShape(def: FeatureFlagDef, value: unknown): void {
  if (def.type === 'boolean') {
    if (typeof value !== 'boolean') throw new InvalidFeatureValueError('Invalid value: expected boolean');
  } else {
    if (typeof value !== 'string' || !(def.options as readonly string[]).includes(value)) {
      throw new InvalidFeatureValueError(`Invalid value: expected one of ${def.options.join(', ')}`);
    }
  }
}

function assertDependencies(key: FeatureKey, value: unknown): void {
  const def = FEATURE_REGISTRY[key] as FeatureFlagDef;
  const turningOn = def.type === 'triState' ? value !== 'off' : value === true;
  if (!turningOn) return;
  for (const dep of def.dependsOn ?? []) {
    if (!isEnabled(dep as FeatureKey)) {
      throw new DependencyViolationError(`'${key}' requires '${dep}' to be enabled first`);
    }
  }
}

function featureChangedEvent(key: FeatureKey) {
  return {
    id: crypto.randomUUID(),
    type: 'system.feature.changed' as const,
    tenantId: 'default',
    timestamp: new Date(),
    payload: { key },
  };
}

export async function setFlag(key: FeatureKey, value: unknown, updatedBy: string | null): Promise<void> {
  const def = FEATURE_REGISTRY[key] as FeatureFlagDef | undefined;
  if (!def) throw new Error(`Unknown feature key: ${key}`);
  assertValueShape(def, value);
  assertDependencies(key, value);
  const clamped = clampToHardRequirement(key, value);

  await db.insert(featureFlags)
    .values({ key, value: JSON.stringify(value), updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: { value: JSON.stringify(value), updatedBy, updatedAt: new Date() },
    });

  snapshot.set(key, { value: clamped, source: 'db' });
  // Local dispatch inside emit() is unconditional, so same-instance callers observe the new
  // value immediately even without Redis; other replicas get it via Redis Stream if
  // configured, or within the periodic resync interval otherwise.
  await eventBus.emit(featureChangedEvent(key));
}

export async function resetFlag(key: FeatureKey, updatedBy: string | null): Promise<void> {
  const def = FEATURE_REGISTRY[key] as FeatureFlagDef | undefined;
  if (!def) throw new Error(`Unknown feature key: ${key}`);
  await db.delete(featureFlags).where(eq(featureFlags.key, key));
  snapshot.set(key, { value: def.envDefault(), source: 'env' });
  await eventBus.emit(featureChangedEvent(key));
  void updatedBy; // recorded via audit log at the call site, not stored on delete
}

// Other replicas (or this same replica, reacting to its own emit — dispatchLocal already ran
// synchronously inside setFlag()'s eventBus.emit() call, so this firing again for the *same*
// instance is a harmless, idempotent re-read of one row) re-sync just the changed key.
eventBus.on('system.feature.changed', async (event) => {
  const key = (event.payload as { key?: string }).key;
  if (!key || !(key in FEATURE_REGISTRY)) return;
  try {
    const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    const def = FEATURE_REGISTRY[key as FeatureKey] as FeatureFlagDef;
    if (row) {
      const parsed = JSON.parse(row.value);
      snapshot.set(key as FeatureKey, { value: clampToHardRequirement(key as FeatureKey, parsed), source: 'db' });
    } else {
      snapshot.set(key as FeatureKey, { value: def.envDefault(), source: 'env' });
    }
  } catch (err: any) {
    logger.warn(`feature.service: failed to refresh '${key}': ${err.message}`);
  }
});

/** Safety-net poll — the only cross-replica sync mechanism when REDIS_URL is unset (in that
 *  mode, emit()'s local dispatch only reaches the instance that called setFlag()). Even with
 *  Redis, this catches a replica that was down/partitioned when the event fired. */
export function startPeriodicResync(intervalMs = 30_000): void {
  stopPeriodicResync();
  resyncTimer = setInterval(() => {
    loadFlags().catch(err => logger.warn(`feature.service: periodic resync failed: ${err.message}`));
  }, intervalMs);
  resyncTimer.unref();
}

export function stopPeriodicResync(): void {
  if (resyncTimer) { clearInterval(resyncTimer); resyncTimer = null; }
}

// Test-only escape hatches — mirrors cache.service.ts's resetCacheForTests().
export function setFlagForTests(key: FeatureKey, value: unknown): void {
  snapshot.set(key, { value, source: 'db' });
}

export function resetFeatureSnapshotForTests(): void {
  snapshot = buildEnvSnapshot();
  loadedOnce = false;
}
