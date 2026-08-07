import { pgTable, text, timestamp, boolean, integer, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

// --- Phase 2.1: MFA ---

export const mfaFactors = pgTable('mfa_factors', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),          // totp | sms | email | webauthn | recovery
  name: text('name'),
  secretEnc: text('secret_enc'),         // TOTP secret (encryptToken) or recovery code bcrypt hash
  phone: text('phone'),
  email: text('email'),
  credentialId: text('credential_id'),   // WebAuthn credential id (base64url)
  publicKey: text('public_key'),         // WebAuthn public key (base64url)
  counter: integer('counter').default(0),
  transports: text('transports'),
  status: text('status').notNull().default('pending'),  // pending | active | disabled | used
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_mfa_factors_user').on(t.userId, t.type),
]);

export const mfaChallenges = pgTable('mfa_challenges', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  factorId: text('factor_id'),
  type: text('type').notNull(),          // totp | sms | email | webauthn | recovery
  codeHash: text('code_hash'),           // sha256(code) for sms/email OTP
  challenge: text('challenge'),          // WebAuthn challenge (base64url) or setup nonce
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_mfa_challenges_user').on(t.userId),
]);

export const tenantMfaPolicies = pgTable('tenant_mfa_policies', {
  tenantId: text('tenant_id').primaryKey().references(() => tenants.id),
  required: boolean('required').default(false),
  requiredForAdmins: boolean('required_for_admins').default(true),
  allowedTypes: text('allowed_types').default('totp,webauthn,email'),
  rememberDeviceDays: integer('remember_device_days').default(30),
  updatedAt: timestamp('updated_at').defaultNow(),
});
