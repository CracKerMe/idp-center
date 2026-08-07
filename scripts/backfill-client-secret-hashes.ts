import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { isNull } from 'drizzle-orm';
import { clients } from '../server/schema.js';
import { eq } from 'drizzle-orm';

// One-off: hashes every clients.client_secret that predates the bcrypt migration and hasn't
// been lazily upgraded by a successful token request yet (client_secret_hash IS NULL). Run once
// against production before dropping the plaintext client_secret column.
async function main() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client);

  const rows = await db
    .select({ id: clients.id, clientId: clients.clientId, clientSecret: clients.clientSecret })
    .from(clients)
    .where(isNull(clients.clientSecretHash));

  console.log(`Found ${rows.length} client(s) with no client_secret_hash.`);

  for (const row of rows) {
    if (!row.clientSecret) continue;
    const hash = await bcrypt.hash(row.clientSecret, 10);
    await db.update(clients).set({ clientSecretHash: hash, clientSecretAlg: 'bcrypt' }).where(eq(clients.id, row.id));
    console.log(`Hashed secret for client ${row.clientId}`);
  }

  console.log('Done.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
