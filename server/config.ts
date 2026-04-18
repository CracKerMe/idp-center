import 'dotenv/config';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const EnvSchema = z.object({
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少需要 32 个字符'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET 至少需要 32 个字符'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5986),
  APP_URL: z.url().default('http://localhost:5986'),
  SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
  SMTP_PORT: z.coerce.number().int().positive('SMTP_PORT must be a positive integer'),
  SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
  SMTP_PASS: z.string().min(1, 'SMTP_PASS is required'),
  SMTP_FROM: z.string().min(1, 'SMTP_FROM is required'),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.url().optional(),
  ENCRYPTION_KEY: z.string().min(32).optional(),
  DB_PATH: z.string().default('auth.db'),
  JWT_EXPIRES_IN: z.string().default('1h'),
});

const _env = EnvSchema.safeParse(process.env);
if (!_env.success) {
  console.error('❌ 环境变量校验失败：');
  console.error(_env.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = _env.data;

export const SECURITY_CONFIG = {
  maxFailedAttempts: 5,
  lockDurationMinutes: 15,
};

// Project root directory (server/config.ts lives at <root>/server/config.ts)
export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
