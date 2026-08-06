import { and, eq } from 'drizzle-orm';
import { db } from '../../database.js';
import { decryptToken } from '../../services/crypto.js';
import { identityProviders } from '../../schema.js';

export type IdentityProviderRow = typeof identityProviders.$inferSelect;

/** Loads an enabled identity_providers row and decrypts its per-type config JSON. */
export async function loadIdp<T = Record<string, unknown>>(
  tenantId: string,
  alias: string,
  type: string
): Promise<{ row: IdentityProviderRow; config: T } | null> {
  const [row] = await db.select().from(identityProviders).where(and(
    eq(identityProviders.tenantId, tenantId),
    eq(identityProviders.alias, alias),
    eq(identityProviders.type, type),
    eq(identityProviders.enabled, true),
  )).limit(1);

  if (!row) return null;
  return { row, config: JSON.parse(decryptToken(row.configEnc)) as T };
}

export function loginErrorRedirect(message: string): string {
  return `/#/login?error=${encodeURIComponent(message)}`;
}
