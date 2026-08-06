import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { users } from '../server/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  const url = process.env.DATABASE_URL!;
  console.log('Connecting to:', url.replace(/:[^@]+@/, ':***@'));
  const client = postgres(url);
  const db = drizzle(client);

  const newPassword = 'Admin@12345';
  const hash = bcrypt.hashSync(newPassword, 10);

  const result = await db.update(users).set({
    passwordHash: hash,
    mustChangePassword: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date(),
  }).where(eq(users.username, 'admin')).returning();

  console.log(result.length > 0 ? `✅ admin 密码已重置为: ${newPassword}` : '❌ admin 用户不存在');
  await client.end();
}

main();
