import crypto from 'crypto';
import { eq, and, lte } from 'drizzle-orm';
import { db } from '../database.js';
import { backchannelLogoutDeliveries, clients, oidcSessions } from '../schema.js';
import { signLogoutToken } from '../oauth/jwt.js';

const MAX_ATTEMPTS = 3;
const DELIVERY_TIMEOUT_MS = 5000;
const BACKOFF_MS = [0, 5000, 30000];

export interface OidcSessionRow {
  id: string;
  sid: string;
  userId: string;
  clientId: string;
  tenantId: string;
}

/** Queues a back-channel logout delivery for a session's client, if it registered a backchannel_logout_uri. */
export async function enqueueBackchannelLogout(session: OidcSessionRow): Promise<void> {
  const [client] = await db
    .select({ backchannelLogoutUri: clients.backchannelLogoutUri })
    .from(clients)
    .where(eq(clients.clientId, session.clientId))
    .limit(1);

  if (!client?.backchannelLogoutUri) return;

  await db.insert(backchannelLogoutDeliveries).values({
    id: crypto.randomUUID(),
    oidcSessionId: session.id,
    clientId: session.clientId,
    url: client.backchannelLogoutUri,
  });
}

async function buildLogoutToken(session: { sid: string; userId: string; clientId: string }): Promise<string> {
  return signLogoutToken({
    sub: session.userId,
    sid: session.sid,
    aud: session.clientId,
    jti: crypto.randomUUID(),
    events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
  });
}

/**
 * Drains pending back-channel logout deliveries. Meant to be called from the
 * same interval as cleanupExpiredTokens — logout responses must never block
 * on RP availability, so this always runs out-of-band, after the fact.
 */
export async function drainBackchannelQueue(): Promise<number> {
  const now = new Date();
  const pending = await db
    .select()
    .from(backchannelLogoutDeliveries)
    .where(and(eq(backchannelLogoutDeliveries.status, 'pending'), lte(backchannelLogoutDeliveries.nextAttemptAt, now)))
    .limit(50);

  let delivered = 0;

  for (const delivery of pending) {
    const [session] = await db.select().from(oidcSessions).where(eq(oidcSessions.id, delivery.oidcSessionId)).limit(1);
    if (!session) {
      await db
        .update(backchannelLogoutDeliveries)
        .set({ status: 'failed', lastError: 'oidc session no longer exists' })
        .where(eq(backchannelLogoutDeliveries.id, delivery.id));
      continue;
    }

    try {
      const logoutToken = await buildLogoutToken({ sid: session.sid, userId: session.userId, clientId: delivery.clientId });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(delivery.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `logout_token=${encodeURIComponent(logoutToken)}`,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) throw new Error(`RP responded ${res.status}`);

      await db.update(backchannelLogoutDeliveries).set({ status: 'delivered' }).where(eq(backchannelLogoutDeliveries.id, delivery.id));
      delivered++;
    } catch (err) {
      const attempts = delivery.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await db
        .update(backchannelLogoutDeliveries)
        .set({
          attempts,
          status: failed ? 'failed' : 'pending',
          nextAttemptAt: new Date(Date.now() + (BACKOFF_MS[attempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1])),
          lastError: err instanceof Error ? err.message : String(err),
        })
        .where(eq(backchannelLogoutDeliveries.id, delivery.id));
    }
  }

  return delivered;
}
