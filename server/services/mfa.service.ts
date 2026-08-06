import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { and, eq, gt, isNull, desc } from 'drizzle-orm';
import { db } from '../database.js';
import { config, MFA_CONFIG } from '../config.js';
import { encryptToken, decryptToken } from './crypto.js';
import { mfaFactors, mfaChallenges, users } from '../schema.js';
import { emailService } from './email.service.js';
import { sendOtpSms } from './sms.service.js';

export type MfaFactorType = 'totp' | 'sms' | 'email' | 'webauthn' | 'recovery';

export interface MfaFactorSummary {
  id: string;
  type: MfaFactorType;
  name: string | null;
  status: string;
  createdAt: Date | null;
  lastUsedAt: Date | null;
}

function rpID(): string {
  return new URL(config.APP_URL).hostname;
}

function rpOrigin(): string {
  return config.APP_URL;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generateNumericCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += crypto.randomInt(10).toString();
  return code;
}

// ─── Factor listing / status ────────────────────────────────────────────────

export async function listFactors(userId: string): Promise<MfaFactorSummary[]> {
  const rows = await db.select().from(mfaFactors).where(and(
    eq(mfaFactors.userId, userId),
    eq(mfaFactors.status, 'active'),
  ));
  return rows.map(r => ({
    id: r.id,
    type: r.type as MfaFactorType,
    name: r.name,
    status: r.status,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

export async function getActiveFactors(userId: string) {
  return db.select().from(mfaFactors).where(and(
    eq(mfaFactors.userId, userId),
    eq(mfaFactors.status, 'active'),
  ));
}

export async function hasMfaEnabled(userId: string): Promise<boolean> {
  const factors = await getActiveFactors(userId);
  // A lone 'recovery' factor set isn't a real second factor by itself.
  return factors.some(f => f.type !== 'recovery');
}

export async function getActiveFactor(userId: string, factorId: string) {
  const [row] = await db.select().from(mfaFactors).where(and(
    eq(mfaFactors.id, factorId),
    eq(mfaFactors.userId, userId),
    eq(mfaFactors.status, 'active'),
  )).limit(1);
  return row ?? null;
}

export async function disableFactor(userId: string, factorId: string): Promise<boolean> {
  const result = await db.update(mfaFactors)
    .set({ status: 'disabled' })
    .where(and(eq(mfaFactors.id, factorId), eq(mfaFactors.userId, userId)))
    .returning({ id: mfaFactors.id });
  return result.length > 0;
}

// ─── TOTP ────────────────────────────────────────────────────────────────────

export async function beginTotpSetup(userId: string, username: string): Promise<{ factorId: string; secret: string; qrCodeUrl: string }> {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(username, 'IdP Center', secret);
  const factorId = crypto.randomUUID();

  await db.insert(mfaFactors).values({
    id: factorId,
    userId,
    type: 'totp',
    secretEnc: encryptToken(secret),
    status: 'pending',
  });

  const qrCodeUrl = await qrcode.toDataURL(otpauth);
  return { factorId, secret, qrCodeUrl };
}

export async function confirmTotpSetup(userId: string, factorId: string, token: string): Promise<boolean> {
  const [factor] = await db.select().from(mfaFactors).where(and(
    eq(mfaFactors.id, factorId),
    eq(mfaFactors.userId, userId),
    eq(mfaFactors.type, 'totp'),
    eq(mfaFactors.status, 'pending'),
  )).limit(1);
  if (!factor || !factor.secretEnc) return false;

  const secret = decryptToken(factor.secretEnc);
  if (!authenticator.check(token, secret)) return false;

  await db.update(mfaFactors).set({ status: 'active', name: 'Authenticator App' }).where(eq(mfaFactors.id, factorId));
  return true;
}

/**
 * Backfills users.otp_secret/otp_enabled (pre-2.1 plaintext TOTP) into encrypted mfa_factors
 * rows, idempotently. Called once from initDatabase() on every startup — cheap no-op once
 * every legacy user has been migrated. The legacy columns stay populated in parallel for one
 * release window (plan §2.1); routes/auth.ts's /otp/setup and /otp/verify keep both in sync.
 */
export async function migrateLegacyTotpFactors(): Promise<number> {
  const legacyUsers = await db.select({ id: users.id, otpSecret: users.otpSecret })
    .from(users)
    .where(and(eq(users.otpEnabled, true)));

  let migrated = 0;
  for (const u of legacyUsers) {
    if (!u.otpSecret) continue;

    const [existing] = await db.select({ id: mfaFactors.id }).from(mfaFactors).where(and(
      eq(mfaFactors.userId, u.id),
      eq(mfaFactors.type, 'totp'),
      eq(mfaFactors.status, 'active'),
    )).limit(1);
    if (existing) continue;

    await db.insert(mfaFactors).values({
      id: crypto.randomUUID(),
      userId: u.id,
      type: 'totp',
      name: 'Authenticator App',
      secretEnc: encryptToken(u.otpSecret),
      status: 'active',
    });
    migrated++;
  }
  return migrated;
}

export async function verifyTotp(userId: string, factorId: string, token: string): Promise<boolean> {
  const factor = await getActiveFactor(userId, factorId);
  if (!factor || factor.type !== 'totp' || !factor.secretEnc) return false;

  const secret = decryptToken(factor.secretEnc);
  const valid = authenticator.check(token, secret);
  if (valid) await db.update(mfaFactors).set({ lastUsedAt: new Date() }).where(eq(mfaFactors.id, factor.id));
  return valid;
}

// ─── Email / SMS OTP challenges ─────────────────────────────────────────────

async function issueOtpChallenge(userId: string, factorId: string, type: 'email' | 'sms', destination: string, username: string, purpose: 'login' | 'setup'): Promise<string> {
  const code = generateNumericCode(MFA_CONFIG.otpCodeLength);
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + MFA_CONFIG.otpExpiryMs);

  await db.insert(mfaChallenges).values({
    id: challengeId,
    userId,
    factorId,
    type,
    codeHash: sha256(code),
    expiresAt,
  });

  if (type === 'email') {
    await emailService.sendOtpCodeEmail(destination, code, username, purpose);
  } else {
    await sendOtpSms(destination, code);
  }

  return challengeId;
}

export async function beginEmailFactorSetup(userId: string, email: string, username: string): Promise<{ factorId: string }> {
  const factorId = crypto.randomUUID();
  await db.insert(mfaFactors).values({ id: factorId, userId, type: 'email', email, status: 'pending' });
  await issueOtpChallenge(userId, factorId, 'email', email, username, 'setup');
  return { factorId };
}

export async function beginSmsFactorSetup(userId: string, phone: string, username: string): Promise<{ factorId: string }> {
  const factorId = crypto.randomUUID();
  await db.insert(mfaFactors).values({ id: factorId, userId, type: 'sms', phone, status: 'pending' });
  await issueOtpChallenge(userId, factorId, 'sms', phone, username, 'setup');
  return { factorId };
}

/** Verifies the latest unconsumed OTP challenge for a factor. Used for both setup confirmation and login step-up. */
export async function verifyOtpChallenge(userId: string, factorId: string, code: string): Promise<boolean> {
  const [challenge] = await db.select().from(mfaChallenges).where(and(
    eq(mfaChallenges.userId, userId),
    eq(mfaChallenges.factorId, factorId),
    isNull(mfaChallenges.consumedAt),
    gt(mfaChallenges.expiresAt, new Date()),
  )).orderBy(desc(mfaChallenges.createdAt)).limit(1);

  if (!challenge) return false;

  if (challenge.attempts >= MFA_CONFIG.otpMaxAttempts) return false;

  if (challenge.codeHash !== sha256(code)) {
    await db.update(mfaChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(mfaChallenges.id, challenge.id));
    return false;
  }

  await db.update(mfaChallenges).set({ consumedAt: new Date() }).where(eq(mfaChallenges.id, challenge.id));
  return true;
}

export async function confirmEmailOrSmsSetup(userId: string, factorId: string, code: string): Promise<boolean> {
  const [factor] = await db.select().from(mfaFactors).where(and(
    eq(mfaFactors.id, factorId),
    eq(mfaFactors.userId, userId),
    eq(mfaFactors.status, 'pending'),
  )).limit(1);
  if (!factor) return false;

  const ok = await verifyOtpChallenge(userId, factorId, code);
  if (!ok) return false;

  const name = factor.type === 'email' ? `Email (${factor.email})` : `SMS (${factor.phone})`;
  await db.update(mfaFactors).set({ status: 'active', name }).where(eq(mfaFactors.id, factorId));
  return true;
}

/** Sends a fresh OTP for an already-active factor, e.g. login step-up. */
export async function sendLoginChallenge(userId: string, factorId: string, username: string): Promise<void> {
  const factor = await getActiveFactor(userId, factorId);
  if (!factor) throw new Error('Factor not found or inactive');
  if (factor.type === 'email' && factor.email) {
    await issueOtpChallenge(userId, factorId, 'email', factor.email, username, 'login');
  } else if (factor.type === 'sms' && factor.phone) {
    await issueOtpChallenge(userId, factorId, 'sms', factor.phone, username, 'login');
  } else {
    throw new Error(`Factor type ${factor.type} does not use a push challenge`);
  }
}

export async function verifyLoginOtp(userId: string, factorId: string, code: string): Promise<boolean> {
  const factor = await getActiveFactor(userId, factorId);
  if (!factor || (factor.type !== 'email' && factor.type !== 'sms')) return false;
  const ok = await verifyOtpChallenge(userId, factorId, code);
  if (ok) await db.update(mfaFactors).set({ lastUsedAt: new Date() }).where(eq(mfaFactors.id, factor.id));
  return ok;
}

// ─── Recovery codes ──────────────────────────────────────────────────────────

function generateRecoveryCode(): string {
  return crypto.randomBytes(MFA_CONFIG.recoveryCodeLength).toString('hex').slice(0, MFA_CONFIG.recoveryCodeLength).toUpperCase();
}

/** Replaces all existing recovery codes with a fresh batch. Returns plaintext codes — shown once, never again. */
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  await db.delete(mfaFactors).where(and(eq(mfaFactors.userId, userId), eq(mfaFactors.type, 'recovery')));

  const codes: string[] = [];
  for (let i = 0; i < MFA_CONFIG.recoveryCodeCount; i++) {
    const code = generateRecoveryCode();
    codes.push(code);
    await db.insert(mfaFactors).values({
      id: crypto.randomUUID(),
      userId,
      type: 'recovery',
      name: `Recovery code ${i + 1}`,
      secretEnc: bcrypt.hashSync(code, 10),
      status: 'active',
    });
  }
  return codes;
}

export async function verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
  const rows = await db.select().from(mfaFactors).where(and(
    eq(mfaFactors.userId, userId),
    eq(mfaFactors.type, 'recovery'),
    eq(mfaFactors.status, 'active'),
  ));

  for (const row of rows) {
    if (row.secretEnc && bcrypt.compareSync(code, row.secretEnc)) {
      await db.update(mfaFactors).set({ status: 'used', lastUsedAt: new Date() }).where(eq(mfaFactors.id, row.id));
      return true;
    }
  }
  return false;
}

export async function countRemainingRecoveryCodes(userId: string): Promise<number> {
  const rows = await db.select({ id: mfaFactors.id }).from(mfaFactors).where(and(
    eq(mfaFactors.userId, userId),
    eq(mfaFactors.type, 'recovery'),
    eq(mfaFactors.status, 'active'),
  ));
  return rows.length;
}

// ─── WebAuthn / FIDO2 ────────────────────────────────────────────────────────

export async function beginWebauthnRegistration(userId: string, username: string): Promise<{ factorId: string; options: any }> {
  const existing = await getActiveFactors(userId);
  const excludeCredentials = existing
    .filter(f => f.type === 'webauthn' && f.credentialId)
    .map(f => ({ id: f.credentialId as string, transports: (f.transports?.split(',') as AuthenticatorTransportFuture[]) || undefined }));

  const options = await generateRegistrationOptions({
    rpName: 'IdP Center',
    rpID: rpID(),
    userID: isoUint8Array.fromUTF8String(userId),
    userName: username,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });

  const factorId = crypto.randomUUID();
  await db.insert(mfaFactors).values({ id: factorId, userId, type: 'webauthn', status: 'pending' });
  await db.insert(mfaChallenges).values({
    id: crypto.randomUUID(),
    userId,
    factorId,
    type: 'webauthn',
    challenge: options.challenge,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  return { factorId, options };
}

export async function finishWebauthnRegistration(userId: string, factorId: string, response: RegistrationResponseJSON, name?: string): Promise<boolean> {
  const [challenge] = await db.select().from(mfaChallenges).where(and(
    eq(mfaChallenges.userId, userId),
    eq(mfaChallenges.factorId, factorId),
    eq(mfaChallenges.type, 'webauthn'),
    isNull(mfaChallenges.consumedAt),
    gt(mfaChallenges.expiresAt, new Date()),
  )).orderBy(desc(mfaChallenges.createdAt)).limit(1);
  if (!challenge || !challenge.challenge) return false;

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: rpOrigin(),
    expectedRPID: rpID(),
  });
  if (!verification.verified || !verification.registrationInfo) return false;

  const { credential } = verification.registrationInfo;
  await db.update(mfaChallenges).set({ consumedAt: new Date() }).where(eq(mfaChallenges.id, challenge.id));
  await db.update(mfaFactors).set({
    status: 'active',
    name: name || 'Security Key',
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports?.join(',') || null,
  }).where(eq(mfaFactors.id, factorId));

  return true;
}

export async function beginWebauthnAuthentication(userId: string, factorId: string): Promise<any> {
  const factor = await getActiveFactor(userId, factorId);
  if (!factor || factor.type !== 'webauthn' || !factor.credentialId) throw new Error('Factor not found');

  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    allowCredentials: [{ id: factor.credentialId, transports: factor.transports?.split(',') as AuthenticatorTransportFuture[] | undefined }],
    userVerification: 'preferred',
  });

  await db.insert(mfaChallenges).values({
    id: crypto.randomUUID(),
    userId,
    factorId,
    type: 'webauthn',
    challenge: options.challenge,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  return options;
}

export async function verifyWebauthnAuthentication(userId: string, factorId: string, response: AuthenticationResponseJSON): Promise<boolean> {
  const factor = await getActiveFactor(userId, factorId);
  if (!factor || factor.type !== 'webauthn' || !factor.credentialId || !factor.publicKey) return false;

  const [challenge] = await db.select().from(mfaChallenges).where(and(
    eq(mfaChallenges.userId, userId),
    eq(mfaChallenges.factorId, factorId),
    eq(mfaChallenges.type, 'webauthn'),
    isNull(mfaChallenges.consumedAt),
    gt(mfaChallenges.expiresAt, new Date()),
  )).orderBy(desc(mfaChallenges.createdAt)).limit(1);
  if (!challenge || !challenge.challenge) return false;

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: rpOrigin(),
    expectedRPID: rpID(),
    credential: {
      id: factor.credentialId,
      publicKey: isoBase64URL.toBuffer(factor.publicKey),
      counter: factor.counter ?? 0,
      transports: factor.transports?.split(',') as AuthenticatorTransportFuture[] | undefined,
    },
  });
  if (!verification.verified) return false;

  await db.update(mfaChallenges).set({ consumedAt: new Date() }).where(eq(mfaChallenges.id, challenge.id));
  await db.update(mfaFactors).set({
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: new Date(),
  }).where(eq(mfaFactors.id, factor.id));

  return true;
}
