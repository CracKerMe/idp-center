/**
 * Token Blacklist Management Module
 * Provides immediate revocation capability for access tokens
 */

import { db } from '../database.js';
import { accessTokens } from '../schema.js';
import { eq, and, gt, lt, inArray, ne } from 'drizzle-orm';

export interface TokenBlacklistEntry {
  id: string;
  token: string;
  user_id: string;
  revoked: boolean;
  revoked_at: Date | null;
  revoke_reason: string | null;
  expires_at: Date;
}

export enum RevokeReason {
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  SECURITY_BREACH = 'SECURITY_BREACH',
  ADMIN_REVOCATION = 'ADMIN_REVOCATION',
  SESSION_INVALIDATION = 'SESSION_INVALIDATION',
}

/**
 * Revoke a specific access token
 */
export async function revokeToken(
  token: string,
  reason: RevokeReason = RevokeReason.LOGOUT
): Promise<boolean> {
  try {
    const result = await db
      .update(accessTokens)
      .set({ revoked: true, revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(accessTokens.token, token), eq(accessTokens.revoked, false)));

    return ((result as any).rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Failed to revoke token:', error);
    return false;
  }
}

/**
 * Check if a token is revoked
 */
export async function isTokenRevoked(token: string): Promise<boolean> {
  const [record] = await db
    .select({ revoked: accessTokens.revoked })
    .from(accessTokens)
    .where(eq(accessTokens.token, token))
    .limit(1);

  return !record || record.revoked === true;
}

/**
 * Revoke all tokens for a specific user
 */
export async function revokeAllUserTokens(
  userId: string,
  reason: RevokeReason = RevokeReason.SESSION_INVALIDATION
): Promise<number> {
  try {
    const result = await db
      .update(accessTokens)
      .set({ revoked: true, revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(accessTokens.userId, userId), eq(accessTokens.revoked, false)));

    return (result as any).rowCount ?? 0;
  } catch (error) {
    console.error('Failed to revoke user tokens:', error);
    return 0;
  }
}

/**
 * Revoke all tokens for a user except the current one
 */
export async function revokeOtherUserTokens(
  userId: string,
  currentToken: string,
  reason: RevokeReason = RevokeReason.SESSION_INVALIDATION
): Promise<number> {
  try {
    const result = await db
      .update(accessTokens)
      .set({ revoked: true, revokedAt: new Date(), revokeReason: reason })
      .where(and(
        eq(accessTokens.userId, userId),
        ne(accessTokens.token, currentToken),
        eq(accessTokens.revoked, false)
      ));

    return (result as any).rowCount ?? 0;
  } catch (error) {
    console.error('Failed to revoke other user tokens:', error);
    return 0;
  }
}

/**
 * Get all active (non-revoked) tokens for a user
 */
export async function getActiveTokensForUser(userId: string): Promise<TokenBlacklistEntry[]> {
  const rows = await db
    .select({
      id: accessTokens.id,
      token: accessTokens.token,
      userId: accessTokens.userId,
      revoked: accessTokens.revoked,
      revokedAt: accessTokens.revokedAt,
      revokeReason: accessTokens.revokeReason,
      expiresAt: accessTokens.expiresAt,
    })
    .from(accessTokens)
    .where(and(
      eq(accessTokens.userId, userId),
      eq(accessTokens.revoked, false),
      gt(accessTokens.expiresAt, new Date())
    ))
    .orderBy(accessTokens.expiresAt);

  return rows.map(r => ({
    id: r.id,
    token: r.token,
    user_id: r.userId,
    revoked: r.revoked ?? false,
    revoked_at: r.revokedAt,
    revoke_reason: r.revokeReason,
    expires_at: r.expiresAt,
  }));
}

/**
 * Get revocation history for a token
 */
export async function getTokenRevocationInfo(token: string): Promise<TokenBlacklistEntry | null> {
  const [row] = await db
    .select({
      id: accessTokens.id,
      token: accessTokens.token,
      userId: accessTokens.userId,
      revoked: accessTokens.revoked,
      revokedAt: accessTokens.revokedAt,
      revokeReason: accessTokens.revokeReason,
      expiresAt: accessTokens.expiresAt,
    })
    .from(accessTokens)
    .where(eq(accessTokens.token, token))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    token: row.token,
    user_id: row.userId,
    revoked: row.revoked ?? false,
    revoked_at: row.revokedAt,
    revoke_reason: row.revokeReason,
    expires_at: row.expiresAt,
  };
}

/**
 * Cleanup expired revoked tokens (can be called periodically)
 */
export async function cleanupRevokedTokens(): Promise<number> {
  try {
    const result = await db
      .delete(accessTokens)
      .where(and(eq(accessTokens.revoked, true), lt(accessTokens.expiresAt, new Date())));

    return (result as any).rowCount ?? 0;
  } catch (error) {
    console.error('Failed to cleanup revoked tokens:', error);
    return 0;
  }
}

/**
 * Batch revoke tokens by user IDs (for admin use)
 */
export async function batchRevokeByUserIds(
  userIds: string[],
  reason: RevokeReason = RevokeReason.ADMIN_REVOCATION
): Promise<number> {
  if (userIds.length === 0) return 0;

  try {
    const result = await db
      .update(accessTokens)
      .set({ revoked: true, revokedAt: new Date(), revokeReason: reason })
      .where(and(inArray(accessTokens.userId, userIds), eq(accessTokens.revoked, false)));

    return (result as any).rowCount ?? 0;
  } catch (error) {
    console.error('Failed to batch revoke tokens:', error);
    return 0;
  }
}
