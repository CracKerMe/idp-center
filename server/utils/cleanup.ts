import { db } from '../database.js';
import { accessTokens, refreshTokens, authCodes, oauthStates, passwordResets, trustedDevices, signingKeys, deviceCodes, clientAssertionJtis, pushedAuthRequests, dpopJtis, auditLogs, tenants } from '../schema.js';
import { and, eq, lt, or } from 'drizzle-orm';
import { rotateSigningKeyIfDue } from '../services/keys.service.js';
import { drainBackchannelQueue } from '../services/backchannel-logout.service.js';
import { logger } from './logger.js';
import { cleanupRuns, cleanupItemsRemoved } from './metrics.js';

export interface CleanupResult {
  accessTokens: number;
  refreshTokens: number;
  authCodes: number;
  oauthStates: number;
  passwordResets: number;
  trustedDevices: number;
  signingKeys: number;
  deviceCodes: number;
  clientAssertionJtis: number;
  pushedAuthRequests: number;
  dpopJtis: number;
  backchannelLogoutsDelivered: number;
  auditLogsPurged: number;
}

/**
 * Deletes audit_logs rows older than each tenant's configured retention window
 * (tenants.settings.auditRetentionDays). A tenant with no value set — the default — keeps
 * its audit trail forever; retention is opt-in, not an automatic default deletion, since
 * silently discarding audit history without an explicit admin decision would undermine the
 * whole point of having it.
 *
 * Known tradeoff: this purge necessarily breaks the hash chain at its boundary (GET
 * /api/admin/audit/verify's chain_broken check can't distinguish "deleted by retention
 * policy" from "deleted by tampering" — both look like a missing predecessor). We log the
 * purge here for operators' own traceability, but there's no fix for the verify endpoint
 * itself short of maintaining a separate signed ledger of purge events, which is out of
 * scope for this pass.
 */
async function purgeExpiredAuditLogs(): Promise<number> {
  const allTenants = await db.select({ id: tenants.id, settings: tenants.settings }).from(tenants);
  let purged = 0;

  for (const tenant of allTenants) {
    let retentionDays: number | undefined;
    try {
      retentionDays = JSON.parse(tenant.settings || '{}')?.auditRetentionDays;
    } catch {
      continue;
    }
    if (!retentionDays || retentionDays <= 0) continue;

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await db.delete(auditLogs).where(and(eq(auditLogs.tenantId, tenant.id), lt(auditLogs.createdAt, cutoff)));
    const count = Number((result as any).count) || 0;
    if (count > 0) {
      logger.info(`Purged ${count} expired audit log rows for tenant ${tenant.id} (retention: ${retentionDays}d)`);
    }
    purged += count;
  }

  return purged;
}

export async function cleanupExpiredTokens(): Promise<CleanupResult> {
  const now = new Date();
  cleanupRuns.inc({ job: 'tokens' });

  const atResult = await db.delete(accessTokens).where(lt(accessTokens.expiresAt, now));
  const rtResult = await db.delete(refreshTokens).where(and(lt(refreshTokens.expiresAt, now), eq(refreshTokens.revoked, true)));
  const acResult = await db.delete(authCodes).where(lt(authCodes.expiresAt, now));
  const osResult = await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));
  const prResult = await db.delete(passwordResets).where(and(lt(passwordResets.expiresAt, now), eq(passwordResets.used, true)));
  const tdResult = await db.delete(trustedDevices).where(lt(trustedDevices.expiresAt, now));
  const skResult = await db.delete(signingKeys).where(and(eq(signingKeys.status, 'retired'), lt(signingKeys.expiresAt, now)));
  const dcResult = await db.delete(deviceCodes).where(or(lt(deviceCodes.expiresAt, now), eq(deviceCodes.status, 'redeemed')));
  const cajResult = await db.delete(clientAssertionJtis).where(lt(clientAssertionJtis.expiresAt, now));
  const parResult = await db.delete(pushedAuthRequests).where(lt(pushedAuthRequests.expiresAt, now));
  const dpopResult = await db.delete(dpopJtis).where(lt(dpopJtis.expiresAt, now));

  const removedCounts = {
    accessTokens: Number((atResult as any).count),
    refreshTokens: Number((rtResult as any).count),
    authCodes: Number((acResult as any).count),
    oauthStates: Number((osResult as any).count),
    passwordResets: Number((prResult as any).count),
    trustedDevices: Number((tdResult as any).count),
    signingKeys: Number((skResult as any).count),
    deviceCodes: Number((dcResult as any).count),
    clientAssertionJtis: Number((cajResult as any).count),
    pushedAuthRequests: Number((parResult as any).count),
    dpopJtis: Number((dpopResult as any).count),
  };

  // Record removed items
  for (const [job, count] of Object.entries(removedCounts)) {
    if (count > 0) cleanupItemsRemoved.inc({ job }, count);
  }

  await rotateSigningKeyIfDue();
  const backchannelLogoutsDelivered = await drainBackchannelQueue();
  const auditLogsPurged = await purgeExpiredAuditLogs();

  return {
    ...removedCounts,
    auditLogsPurged,
    backchannelLogoutsDelivered,
  };
}
