import crypto from 'crypto';
import * as jose from 'jose';
import { eq, and, gt, or, isNull, sql } from 'drizzle-orm';
import { db } from '../database.js';
import { signingKeys } from '../schema.js';
import { encryptToken, decryptToken } from './crypto.js';
import { signingKeyRotations, jwksRequests } from '../utils/metrics.js';

// Arbitrary fixed key for pg_advisory_xact_lock — serializes concurrent
// ensureKeysInitialized() callers (e.g. parallel test-file boots) so we never
// end up with more than one 'active' or 'next' signing key row.
const KEY_INIT_LOCK_ID = 7264193;

const ALG = 'RS256';
const CACHE_TTL_MS = 60_000;
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000; // retired keys stay verifiable for at least 24h

export interface ActiveSigner {
  kid: string;
  alg: string;
  key: CryptoKey;
}

let activeSignerCache: { signer: ActiveSigner; cachedAt: number } | null = null;
const verificationKeyCache = new Map<string, { key: CryptoKey; cachedAt: number }>();

export function clearKeyCache(): void {
  activeSignerCache = null;
  verificationKeyCache.clear();
}

async function insertKeyRow(status: 'active' | 'next', executor: Pick<typeof db, 'insert'> = db): Promise<{ kid: string; publicJwk: jose.JWK }> {
  const { publicKey, privateKey } = await jose.generateKeyPair(ALG, { extractable: true, modulusLength: 2048 });
  const publicJwk = await jose.exportJWK(publicKey);
  const privateJwk = await jose.exportJWK(privateKey);
  const kid = await jose.calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  publicJwk.alg = ALG;
  publicJwk.use = 'sig';
  privateJwk.kid = kid;

  await executor.insert(signingKeys).values({
    id: crypto.randomUUID(),
    kid,
    alg: ALG,
    use: 'sig',
    publicJwk: JSON.stringify(publicJwk),
    privateJwkEnc: encryptToken(JSON.stringify(privateJwk)),
    status,
    activatedAt: status === 'active' ? new Date() : null,
  });

  return { kid, publicJwk };
}

/** Generate a new signing key row. Returns the new kid. */
export async function generateSigningKey(status: 'active' | 'next' = 'next'): Promise<string> {
  const { kid } = await insertKeyRow(status);
  clearKeyCache();
  return kid;
}

/** Called once at boot (from initDatabase's seed phase) — idempotent and safe under concurrent callers. */
export async function ensureKeysInitialized(): Promise<void> {
  await db.transaction(async (tx) => {
    // Serializes concurrent boots (e.g. parallel test files) so at most one
    // 'active' and one 'next' row ever get inserted.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${KEY_INIT_LOCK_ID})`);

    const [active] = await tx
      .select({ id: signingKeys.id })
      .from(signingKeys)
      .where(eq(signingKeys.status, 'active'))
      .limit(1);

    if (!active) {
      await insertKeyRow('active', tx);
    }

    const [next] = await tx
      .select({ id: signingKeys.id })
      .from(signingKeys)
      .where(eq(signingKeys.status, 'next'))
      .limit(1);

    if (!next) {
      await insertKeyRow('next', tx);
    }
  });

  clearKeyCache();
}

export async function getActiveSigner(): Promise<ActiveSigner> {
  if (activeSignerCache && Date.now() - activeSignerCache.cachedAt < CACHE_TTL_MS) {
    return activeSignerCache.signer;
  }

  const [row] = await db
    .select()
    .from(signingKeys)
    .where(eq(signingKeys.status, 'active'))
    .orderBy(signingKeys.createdAt)
    .limit(1);

  if (!row) {
    throw new Error('No active signing key — has ensureKeysInitialized() run?');
  }

  const privateJwk = JSON.parse(decryptToken(row.privateJwkEnc)) as jose.JWK;
  const key = (await jose.importJWK(privateJwk, row.alg)) as CryptoKey;
  const signer: ActiveSigner = { kid: row.kid, alg: row.alg, key };
  activeSignerCache = { signer, cachedAt: Date.now() };
  return signer;
}

export async function getVerificationKey(kid: string): Promise<CryptoKey | null> {
  const cached = verificationKeyCache.get(kid);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.key;
  }

  const [row] = await db
    .select()
    .from(signingKeys)
    .where(eq(signingKeys.kid, kid))
    .limit(1);

  if (!row) return null;
  if (row.status === 'retired' && row.expiresAt && row.expiresAt < new Date()) return null;

  const publicJwk = JSON.parse(row.publicJwk) as jose.JWK;
  const key = (await jose.importJWK(publicJwk, row.alg)) as CryptoKey;
  verificationKeyCache.set(kid, { key, cachedAt: Date.now() });
  return key;
}

/** Publishes active + next + not-yet-expired retired public keys for /.well-known/jwks.json */
export async function publishJwks(): Promise<{ keys: jose.JWK[] }> {
  const rows = await db
    .select()
    .from(signingKeys)
    .where(
      or(
        eq(signingKeys.status, 'active'),
        eq(signingKeys.status, 'next'),
        and(eq(signingKeys.status, 'retired'), or(isNull(signingKeys.expiresAt), gt(signingKeys.expiresAt, new Date())))
      )
    );

  return { keys: rows.map((r) => JSON.parse(r.publicJwk) as jose.JWK) };
}

/** Promotes next -> active, retires the old active (with grace window), and mints a new next. */
export async function rotateKeys(opts?: { retireGraceMs?: number }): Promise<{ newKid: string; retiredKid: string | null }> {
  const graceMs = opts?.retireGraceMs ?? ROTATION_GRACE_MS;

  const [oldActive] = await db.select().from(signingKeys).where(eq(signingKeys.status, 'active')).limit(1);
  const [next] = await db.select().from(signingKeys).where(eq(signingKeys.status, 'next')).limit(1);

  if (!next) {
    throw new Error('No "next" signing key available to rotate into — call ensureKeysInitialized() first');
  }

  const now = new Date();
  await db
    .update(signingKeys)
    .set({ status: 'active', activatedAt: now })
    .where(eq(signingKeys.id, next.id));

  let retiredKid: string | null = null;
  if (oldActive) {
    await db
      .update(signingKeys)
      .set({ status: 'retired', retiredAt: now, expiresAt: new Date(now.getTime() + graceMs) })
      .where(eq(signingKeys.id, oldActive.id));
    retiredKid = oldActive.kid;
  }

  await insertKeyRow('next');
  clearKeyCache();

  signingKeyRotations.inc({ outcome: 'success' });

  return { newKid: next.kid, retiredKid };
}

const ROTATION_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;

/** Rotates the active signing key if it has passed the 90-day rotation period. Safe to call frequently. */
export async function rotateSigningKeyIfDue(): Promise<boolean> {
  const [active] = await db.select().from(signingKeys).where(eq(signingKeys.status, 'active')).limit(1);
  if (!active || !active.activatedAt) return false;
  if (Date.now() - active.activatedAt.getTime() < ROTATION_PERIOD_MS) return false;

  await rotateKeys();
  return true;
}
