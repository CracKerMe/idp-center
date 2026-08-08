import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, initDatabase } from '../server/database.js';
import { featureFlags } from '../server/schema/features.js';
import { FEATURE_REGISTRY } from '../server/features/registry.js';
import * as featureService from '../server/services/feature.service.js';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

describe.skipIf(skipIfNoDb)('feature.service', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterEach(async () => {
    // Clean all feature flag rows to ensure full isolation between tests
    await db.delete(featureFlags);
    featureService.resetFeatureSnapshotForTests();
  });

  it('resolves the env default when no DB row exists', () => {
    featureService.resetFeatureSnapshotForTests();
    expect(featureService.getValue('autoHeal')).toBe(FEATURE_REGISTRY.autoHeal.envDefault());
    expect(featureService.getSource('autoHeal')).toBe('env');
  });

  it('setFlag() updates the snapshot synchronously and persists to the DB', async () => {
    await featureService.loadFlags();
    await featureService.setFlag('autoHeal', false, 'test-admin');

    expect(featureService.getValue('autoHeal')).toBe(false);
    expect(featureService.getSource('autoHeal')).toBe('db');

    const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, 'autoHeal')).limit(1);
    expect(row).toBeDefined();
    expect(JSON.parse(row.value)).toBe(false);
  });

  it('resetFlag() falls back to the env default and removes the DB row', async () => {
    await featureService.loadFlags();
    await featureService.setFlag('autoHeal', false, 'test-admin');
    await featureService.resetFlag('autoHeal', 'test-admin');

    expect(featureService.getValue('autoHeal')).toBe(FEATURE_REGISTRY.autoHeal.envDefault());
    expect(featureService.getSource('autoHeal')).toBe('env');

    const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, 'autoHeal')).limit(1);
    expect(row).toBeUndefined();
  });

  it('rejects setFlag() when a dependency is not enabled', async () => {
    await featureService.loadFlags();
    featureService.setFlagForTests('aiAssist', false);

    await expect(featureService.setFlag('alertAiEnrichment', true, 'test-admin'))
      .rejects.toThrow(featureService.DependencyViolationError);
  });

  it('rejects an invalid value shape', async () => {
    await featureService.loadFlags();
    await expect(featureService.setFlag('autoHeal', 'not-a-boolean', 'test-admin'))
      .rejects.toThrow(featureService.InvalidFeatureValueError);
    await expect(featureService.setFlag('riskEngine', 'bogus', 'test-admin'))
      .rejects.toThrow(featureService.InvalidFeatureValueError);
  });

  it('clamps the resolved value to false when a hard requirement is unmet, but still records the write', async () => {
    await featureService.loadFlags();
    await featureService.setFlag('githubSso', true, 'test-admin');

    // Without real GITHUB_CLIENT_ID/SECRET configured in this test environment,
    // hardRequirement.met() is false, so the resolved value must be clamped.
    if (!FEATURE_REGISTRY.githubSso.hardRequirement!.met()) {
      expect(featureService.isEnabled('githubSso')).toBe(false);
    }
    const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, 'githubSso')).limit(1);
    expect(JSON.parse(row.value)).toBe(true);
  });

  it('re-syncs a single key on a system.feature.changed event', async () => {
    const { eventBus } = await import('../server/services/event-bus.service.js');
    await featureService.loadFlags();
    await db.insert(featureFlags).values({ key: 'autoHeal', value: 'false', updatedAt: new Date() })
      .onConflictDoUpdate({ target: featureFlags.key, set: { value: 'false', updatedAt: new Date() } });

    await eventBus.emit({
      id: 'test-event', type: 'system.feature.changed', tenantId: 'default',
      timestamp: new Date(), payload: { key: 'autoHeal' },
    });

    // dispatchLocal awaits handlers synchronously inside emit(), so the snapshot is
    // already updated by the time emit() resolves.
    expect(featureService.getValue('autoHeal')).toBe(false);
    expect(featureService.getSource('autoHeal')).toBe('db');
  });

  it('answers from the env snapshot before loadFlags() is ever called, without querying the DB', () => {
    // resetFeatureSnapshotForTests() reproduces the module's pre-loadFlags() state (a
    // synchronous env-only snapshot) without re-importing the module — re-importing would
    // re-run event-bus.service.ts's prom-client Counter registration and collide with the
    // already-registered metrics in this process.
    featureService.resetFeatureSnapshotForTests();
    expect(featureService.isLoaded()).toBe(false);
    expect(featureService.getValue('autoHeal')).toBe(FEATURE_REGISTRY.autoHeal.envDefault());
    expect(featureService.getSource('autoHeal')).toBe('env');
  });
});
