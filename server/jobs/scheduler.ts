import { sql } from 'drizzle-orm';
import { db } from '../database.js';
import { cleanupExpiredTokens } from '../utils/cleanup.js';
import { runUebaBaselineJob } from './ueba.job.js';
import { logger } from '../utils/logger.js';

interface ScheduledJob {
  name: string;
  /** Arbitrary but must stay stable across deploys — changing it resets that job's leader election. */
  lockId: number;
  intervalMs: number;
  run: () => Promise<unknown>;
}

const JOBS: ScheduledJob[] = [
  // Token/key/device-code cleanup, key rotation, back-channel drain, audit retention purge
  // — all bundled inside cleanupExpiredTokens() already (server/utils/cleanup.ts).
  { name: 'cleanup', lockId: 726420001, intervalMs: 60 * 60 * 1000, run: cleanupExpiredTokens },
  // UEBA baseline recompute (implementation plan §3.2) — nightly full pass; risk.service.ts's
  // updateBaseline() keeps baselines fresh incrementally between runs.
  { name: 'ueba-baseline', lockId: 726420002, intervalMs: 24 * 60 * 60 * 1000, run: runUebaBaselineJob },
];

/**
 * Runs `job` only if this instance wins the per-tick leader election for it. Uses a
 * transaction-scoped PG advisory lock (implementation plan §4.3 — preferred over Redis's
 * SET NX because it needs no extra infra and is already guaranteed available: every
 * instance already talks to the same PG). pg_try_advisory_xact_lock is non-blocking —
 * losers return `locked: false` immediately instead of queueing — and the lock is released
 * automatically on COMMIT/ROLLBACK, so a crash mid-job can't leave it stuck held.
 */
async function runIfLeader(job: ScheduledJob): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx.execute(sql`select pg_try_advisory_xact_lock(${job.lockId}) as locked`) as any;
      if (!row?.locked) return; // another instance is running this tick, or already holds it

      const start = Date.now();
      try {
        await job.run();
        logger.info(`[scheduler] ${job.name} completed in ${Date.now() - start}ms`);
      } catch (err: any) {
        logger.error(`[scheduler] ${job.name} failed: ${err.message}`);
      }
    });
  } catch (err: any) {
    logger.warn(`[scheduler] ${job.name} lock attempt failed: ${err.message}`);
  }
}

const timers: NodeJS.Timeout[] = [];

/**
 * Starts every registered periodic job. Safe to call on every replica — each tick, every
 * instance races for the job's advisory lock; exactly one wins and executes, the rest no-op.
 * This replaces the bare `setInterval(cleanupExpiredTokens, ...)` that server.ts used to run
 * unconditionally, which would have every replica repeating each cleanup pass and each key
 * rotation independently once deployed with replicas >= 2.
 */
export function startScheduler(): void {
  for (const job of JOBS) {
    runIfLeader(job).catch(() => {}); // fire once at boot, same as the old eager cleanupExpiredTokens() call
    const timer = setInterval(() => runIfLeader(job).catch(() => {}), job.intervalMs);
    timer.unref();
    timers.push(timer);
  }
}

export function stopScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
