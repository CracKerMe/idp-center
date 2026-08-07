import 'dotenv/config';
import { z } from 'zod';
import path from 'path';

const EnvSchema = z.object({
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少需要 32 个字符'),
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
  DATABASE_URL: z.string().optional(),
  PG_HOST: z.string().default('localhost'),
  PG_PORT: z.coerce.number().int().positive().default(5432),
  PG_USER: z.string().default('postgres'),
  PG_PASSWORD: z.string().default(''),
  PG_DATABASE: z.string().default('idp_center'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  OAUTH_ENFORCE_GRANT_TYPES: z.coerce.boolean().default(false),

  // First-run seed for the demo `default-client` (server/database.ts). Comma-separated.
  // Admins can add/remove redirect URIs afterwards via /api/admin/clients — these only seed
  // the initial whitelist so the demo works out of the box without hardcoding business domains.
  DEFAULT_CLIENT_REDIRECT_URIS: z.string().default('http://localhost:5986/callback,http://localhost:3000/callback'),
  DEFAULT_CLIENT_POST_LOGOUT_REDIRECT_URIS: z.string().default('http://localhost:5986/,http://localhost:3000/'),
  DEFAULT_CLIENT_FRONTCHANNEL_LOGOUT_URI: z.string().default('http://localhost:3000/logout-frontchannel'),

  // MFA: SMS provider (all optional — defaults to console/dev provider)
  SMS_PROVIDER: z.enum(['console', 'aliyun', 'tencent']).default('console'),
  ALIYUN_SMS_ACCESS_KEY_ID: z.string().optional(),
  ALIYUN_SMS_ACCESS_KEY_SECRET: z.string().optional(),
  ALIYUN_SMS_SIGN_NAME: z.string().optional(),
  ALIYUN_SMS_TEMPLATE_CODE: z.string().optional(),
  TENCENT_SMS_SECRET_ID: z.string().optional(),
  TENCENT_SMS_SECRET_KEY: z.string().optional(),
  TENCENT_SMS_SIGN_NAME: z.string().optional(),
  TENCENT_SMS_TEMPLATE_ID: z.string().optional(),
  TENCENT_SMS_SDK_APP_ID: z.string().optional(),

  // Metrics & Observability
  METRICS_TOKEN: z.string().optional(),  // Bearer token for /metrics endpoint; if empty, only private IPs allowed
  APP_VERSION: z.string().default('1.0.0'),

  // Phase 3: risk engine (adaptive auth). 'off' skips scoring entirely; 'shadow' scores and
  // records but never blocks/challenges a login; 'enforce' applies risk_policies actions.
  // Always start a rollout in 'shadow' for ~2 weeks per the implementation plan.
  RISK_ENGINE_MODE: z.enum(['off', 'shadow', 'enforce']).default('off'),
  GEOIP_DB_PATH: z.string().optional(),   // path to a local MaxMind GeoLite2-City.mmdb; unset disables geo signals

  // Phase 3.3: LLM-assisted admin tooling (audit summaries, policy drafts, compliance gap
  // checks). Entirely optional — every ai-assist endpoint 501s when this is unset.
  ANTHROPIC_API_KEY: z.string().optional(),

  // Phase 4.2: shared cache/rate-limit/leader-election backend. Unset falls back to an
  // in-process implementation — correct on a single instance, not safe across replicas.
  REDIS_URL: z.string().optional(),

  // Phase 4.1: connection pool tuning (postgres.js). Defaults are conservative for a small
  // single-instance deployment; raise PG_POOL_MAX per-replica when running behind PgBouncer.
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  PG_IDLE_TIMEOUT_SEC: z.coerce.number().int().positive().default(30),
  PG_CONNECT_TIMEOUT_SEC: z.coerce.number().int().positive().default(10),
});

const _env = EnvSchema.safeParse(process.env);
if (!_env.success) {
  console.error('❌ 环境变量校验失败：');
  console.error(_env.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = _env.data;

export const connectionString =
  config.DATABASE_URL ||
  `postgres://${config.PG_USER}:${config.PG_PASSWORD}@${config.PG_HOST}:${config.PG_PORT}/${config.PG_DATABASE}`;

export const SECURITY_CONFIG = {
  maxFailedAttempts: 5,
  lockDurationMinutes: 15,
};

/** Centralized token expiry configuration — use these everywhere instead of magic numbers */
export const TOKEN_CONFIG = {
  accessTokenExpiry: '15m',
  accessTokenExpirySeconds: 15 * 60,
  accessTokenExpiryMs: 15 * 60 * 1000,
  refreshTokenExpiryDays: 7,
  refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000,
  refreshTokenRememberMeDays: 30,
  refreshTokenRememberMeMs: 30 * 24 * 60 * 60 * 1000,
  trustedDeviceExpiryDays: 30,
  trustedDeviceExpiryMs: 30 * 24 * 60 * 60 * 1000,
} as const;

/** MFA-specific timing/format constants */
export const MFA_CONFIG = {
  mfaTokenExpirySec: 5 * 60,          // short-lived token used between password check and factor verification
  otpCodeLength: 6,
  otpExpiryMs: 5 * 60 * 1000,         // email/sms OTP validity window
  otpMaxAttempts: 5,
  recoveryCodeCount: 10,
  recoveryCodeLength: 10,
} as const;

// Runtime project root. In production compiled files run from build/, so module-relative paths are unstable.
export const rootDir = path.resolve(process.cwd());

// SMTP config (used by health check)
export const SMTP_CONFIG = {
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
};
