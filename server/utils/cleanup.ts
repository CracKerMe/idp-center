import { db } from '../database.js';
import { accessTokens, refreshTokens, authCodes, oauthStates, passwordResets, trustedDevices, signingKeys } from '../schema.js';
import { and, eq, lt } from 'drizzle-orm';
import { rotateSigningKeyIfDue } from '../services/keys.service.js';

export interface CleanupResult {
  accessTokens: number;
  refreshTokens: number;
  authCodes: number;
  oauthStates: number;
  passwordResets: number;
  trustedDevices: number;
  signingKeys: number;
}

export async function cleanupExpiredTokens(): Promise<CleanupResult> {
  const now = new Date();

  const atResult = await db.delete(accessTokens).where(lt(accessTokens.expiresAt, now));
  const rtResult = await db.delete(refreshTokens).where(and(lt(refreshTokens.expiresAt, now), eq(refreshTokens.revoked, true)));
  const acResult = await db.delete(authCodes).where(lt(authCodes.expiresAt, now));
  const osResult = await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));
  const prResult = await db.delete(passwordResets).where(and(lt(passwordResets.expiresAt, now), eq(passwordResets.used, true)));
  const tdResult = await db.delete(trustedDevices).where(lt(trustedDevices.expiresAt, now));
  const skResult = await db.delete(signingKeys).where(and(eq(signingKeys.status, 'retired'), lt(signingKeys.expiresAt, now)));

  await rotateSigningKeyIfDue();

  return {
    accessTokens: Number((atResult as any).rowCount),
    refreshTokens: Number((rtResult as any).rowCount),
    authCodes: Number((acResult as any).rowCount),
    oauthStates: Number((osResult as any).rowCount),
    passwordResets: Number((prResult as any).rowCount),
    trustedDevices: Number((tdResult as any).rowCount),
    signingKeys: Number((skResult as any).rowCount),
  };
}
