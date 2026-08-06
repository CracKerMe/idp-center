import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

import { connectionString } from './config.js';
import * as schema from './schema.js';
import { users, tenants, clients, accessTokens } from './schema.js';
import { eq, isNull, sql } from 'drizzle-orm';
import { ensureKeysInitialized } from './services/keys.service.js';
import { migrateLegacyTotpFactors } from './services/mfa.service.js';
import { migrateLegacyAdminsToRoles } from './services/rbac.service.js';
import { migrateLegacyLinkedAccounts } from './services/identity-link.service.js';

const client = postgres(connectionString, {
  connect_timeout: 10, // fail fast if PG is unreachable
});
export const db = drizzle(client, { schema });

const execAsync = promisify(exec);

export async function initDatabase() {
  // Push Drizzle schema to PostgreSQL (idempotent — safe to run every startup)
  try {
    const { stderr } = await execAsync('npx drizzle-kit push', {
      cwd: process.cwd(),
      timeout: 30_000,
    });
    if (stderr) console.log(stderr);
  } catch (e: any) {
    if (e.killed) {
      console.warn('⚠️  Schema push timed out after 30s — run "pnpm db:push" manually');
    } else if (e.code === 'ENOENT' || e.message?.includes('ENOENT')) {
      console.warn('⚠️  drizzle-kit not found — skipping schema push (run "pnpm db:push" manually)');
    } else {
      console.error('⚠️  Schema push failed:', e.message);
    }
  }

  await seedDefaults();
  await backfillAccessTokenHashes();
  await ensureKeysInitialized();
  await migrateLegacyTotpFactors();
  await migrateLegacyAdminsToRoles();
  await migrateLegacyLinkedAccounts();
}

/**
 * Backfills access_tokens.token_hash for rows written before hash-based lookup
 * existed. This MUST run in the same release that switches introspect/revoke/
 * userinfo to hash lookups (ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md §1.2), or
 * every already-issued token becomes unresolvable and fails closed.
 */
async function backfillAccessTokenHashes(): Promise<void> {
  try {
    // sha256(token) computed in-database so no token material crosses the wire.
    const result = await db
      .update(accessTokens)
      .set({ tokenHash: sql`encode(digest(${accessTokens.token}, 'sha256'), 'hex')` })
      .where(isNull(accessTokens.tokenHash));
    const count = (result as any).rowCount ?? 0;
    if (count > 0) console.log(`✓ Backfilled token_hash for ${count} access token(s)`);
  } catch (e: any) {
    // pgcrypto may be unavailable; fall back to hashing in Node.
    try {
      const rows = await db
        .select({ id: accessTokens.id, token: accessTokens.token })
        .from(accessTokens)
        .where(isNull(accessTokens.tokenHash));
      for (const row of rows) {
        const hash = crypto.createHash('sha256').update(row.token).digest('hex');
        await db.update(accessTokens).set({ tokenHash: hash }).where(eq(accessTokens.id, row.id));
      }
      if (rows.length > 0) console.log(`✓ Backfilled token_hash for ${rows.length} access token(s)`);
    } catch (inner: any) {
      console.error('⚠️  token_hash backfill failed — existing tokens will be rejected:', inner.message);
    }
  }
}

async function seedDefaults() {
  // Seed default tenant
  const [existingTenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, 'default'))
    .limit(1);

  if (!existingTenant) {
    await db.insert(tenants).values({
      id: 'default',
      name: 'Default Tenant',
      domain: 'localhost',
      isActive: true,
    }).onConflictDoNothing();
  }

  // Seed admin user
  const [adminExists] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, 'admin'))
    .limit(1);

  let generatedAdminPassword: string | null = null;
  if (!adminExists) {
    generatedAdminPassword = crypto.randomBytes(20).toString('hex');
    const hash = bcrypt.hashSync(generatedAdminPassword, 10);
    await db.insert(users).values({
      id: crypto.randomUUID(),
      tenantId: 'default',
      username: 'admin',
      email: 'admin@example.com',
      passwordHash: hash,
      isAdmin: true,
      isPlatformAdmin: true,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      mustChangePassword: true,
    }).onConflictDoNothing();
  }

  // Seed default client
  const [clientExists] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.clientId, 'default-client'))
    .limit(1);

  let generatedClientSecret: string | null = null;
  if (!clientExists) {
    generatedClientSecret = crypto.randomBytes(24).toString('hex');
    await db.insert(clients).values({
      id: crypto.randomUUID(),
      clientId: 'default-client',
      clientSecret: generatedClientSecret,
      clientName: 'Default Client',
      redirectUris: 'http://localhost:5986/callback,http://localhost:3000/callback',
      grantTypes: 'authorization_code',
    }).onConflictDoNothing();
  }

  if (generatedAdminPassword || generatedClientSecret) {
    console.log('\n');
    console.log('\x1b[41m\x1b[97m ⚠️  FIRST-RUN CREDENTIALS (copy these now) \x1b[0m');
    if (generatedAdminPassword) {
      console.log(`\x1b[33m  Admin username : admin`);
      console.log(`  Admin password : \x1b[1m${generatedAdminPassword}\x1b[0m`);
      console.log(`  Note           : You will be required to change this password on first login.\x1b[0m`);
    }
    if (generatedClientSecret) {
      console.log(`\x1b[33m  Client ID      : default-client`);
      console.log(`  Client secret  : \x1b[1m${generatedClientSecret}\x1b[0m\x1b[0m`);
    }
    console.log('\x1b[41m\x1b[97m ────────────────────────────────────────────── \x1b[0m\n');
  }
}
