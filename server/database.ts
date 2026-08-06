import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

import { connectionString } from './config.js';
import * as schema from './schema.js';
import { users, tenants, clients } from './schema.js';
import { eq } from 'drizzle-orm';

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
