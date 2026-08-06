import crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../database.js';
import { oidcSessions } from '../schema.js';

/**
 * Finds the still-live OIDC session for this (browser session, client) pair,
 * or starts a new one. Reused across re-authorizations of the same SSO
 * session so `sid` and `auth_time` stay stable in the id_token, and so
 * RP-initiated logout can find every client tied to a browser session.
 */
export async function getOrCreateOidcSession(opts: {
  browserSessionId: string;
  userId: string;
  clientId: string;
  tenantId: string;
  scope: string;
  amr?: string | null;
  acr?: string | null;
}): Promise<typeof oidcSessions.$inferSelect> {
  const [existing] = await db
    .select()
    .from(oidcSessions)
    .where(and(
      eq(oidcSessions.browserSessionId, opts.browserSessionId),
      eq(oidcSessions.clientId, opts.clientId),
      eq(oidcSessions.tenantId, opts.tenantId),
      isNull(oidcSessions.terminatedAt),
    ))
    .limit(1);

  if (existing) {
    await db.update(oidcSessions).set({ lastRefreshedAt: new Date() }).where(eq(oidcSessions.id, existing.id));
    return existing;
  }

  const [created] = await db
    .insert(oidcSessions)
    .values({
      id: crypto.randomUUID(),
      sid: crypto.randomUUID(),
      browserSessionId: opts.browserSessionId,
      userId: opts.userId,
      clientId: opts.clientId,
      tenantId: opts.tenantId,
      scope: opts.scope,
      amr: opts.amr ?? null,
      acr: opts.acr ?? null,
    })
    .returning();

  return created;
}
