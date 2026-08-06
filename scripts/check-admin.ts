import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users } from '../server/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client);
  const [user] = await db.select({ 
    username: users.username, 
    mustChangePassword: users.mustChangePassword,
    passwordChangedAt: users.passwordChangedAt,
    tenantId: users.tenantId,
  }).from(users).where(eq(users.username, 'admin')).limit(1);
  console.log('admin state:', JSON.stringify(user, null, 2));
  await client.end();
}
main();
