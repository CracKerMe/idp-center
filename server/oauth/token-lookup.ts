import { eq, and } from 'drizzle-orm';
import { db } from '../database.js';
import { accessTokens, refreshTokens } from '../schema.js';

export type ResolvedToken =
  | { kind: 'access'; row: typeof accessTokens.$inferSelect }
  | { kind: 'refresh'; row: typeof refreshTokens.$inferSelect }
  | null;

async function lookupAccess(raw: string, tenantId: string): Promise<typeof accessTokens.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.token, raw), eq(accessTokens.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

async function lookupRefresh(raw: string, tenantId: string): Promise<typeof refreshTokens.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.token, raw), eq(refreshTokens.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

/**
 * Resolves an opaque bearer string to its DB row. The DB row is the source of
 * truth for active/expired/revoked — a syntactically valid but forged JWT has
 * no corresponding row and simply resolves to null.
 */
export async function resolveToken(
  raw: string,
  tenantId: string,
  hint?: 'access_token' | 'refresh_token'
): Promise<ResolvedToken> {
  if (hint === 'refresh_token') {
    const refresh = await lookupRefresh(raw, tenantId);
    if (refresh) return { kind: 'refresh', row: refresh };
    const access = await lookupAccess(raw, tenantId);
    return access ? { kind: 'access', row: access } : null;
  }

  const access = await lookupAccess(raw, tenantId);
  if (access) return { kind: 'access', row: access };
  const refresh = await lookupRefresh(raw, tenantId);
  return refresh ? { kind: 'refresh', row: refresh } : null;
}
