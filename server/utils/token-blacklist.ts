/**
 * Token Blacklist Management Module
 * Provides immediate revocation capability for access tokens
 */

import { db } from '../database.js';

export interface TokenBlacklistEntry {
  id: string;
  token: string;
  user_id: string;
  revoked: number;
  revoked_at: string | null;
  revoke_reason: string | null;
  expires_at: string;
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
export function revokeToken(
  token: string,
  reason: RevokeReason = RevokeReason.LOGOUT
): boolean {
  try {
    const result = db.prepare(`
      UPDATE access_tokens 
      SET revoked = 1, revoked_at = ?, revoke_reason = ?
      WHERE token = ? AND revoked = 0
    `).run(new Date().toISOString(), reason, token);
    
    return result.changes > 0;
  } catch (error) {
    console.error('Failed to revoke token:', error);
    return false;
  }
}

/**
 * Check if a token is revoked
 */
export function isTokenRevoked(token: string): boolean {
  const record = db.prepare(`
    SELECT revoked FROM access_tokens WHERE token = ?
  `).get(token) as { revoked: number } | undefined;
  
  return !record || record.revoked === 1;
}

/**
 * Revoke all tokens for a specific user
 */
export function revokeAllUserTokens(
  userId: string,
  reason: RevokeReason = RevokeReason.SESSION_INVALIDATION
): number {
  try {
    const result = db.prepare(`
      UPDATE access_tokens 
      SET revoked = 1, revoked_at = ?, revoke_reason = ?
      WHERE user_id = ? AND revoked = 0
    `).run(new Date().toISOString(), reason, userId);
    
    return result.changes;
  } catch (error) {
    console.error('Failed to revoke user tokens:', error);
    return 0;
  }
}

/**
 * Revoke all tokens for a user except the current one
 */
export function revokeOtherUserTokens(
  userId: string,
  currentToken: string,
  reason: RevokeReason = RevokeReason.SESSION_INVALIDATION
): number {
  try {
    const result = db.prepare(`
      UPDATE access_tokens 
      SET revoked = 1, revoked_at = ?, revoke_reason = ?
      WHERE user_id = ? AND token != ? AND revoked = 0
    `).run(new Date().toISOString(), reason, userId, currentToken);
    
    return result.changes;
  } catch (error) {
    console.error('Failed to revoke other user tokens:', error);
    return 0;
  }
}

/**
 * Get all active (non-revoked) tokens for a user
 */
export function getActiveTokensForUser(userId: string): TokenBlacklistEntry[] {
  return db.prepare(`
    SELECT id, token, user_id, revoked, revoked_at, revoke_reason, expires_at
    FROM access_tokens 
    WHERE user_id = ? AND revoked = 0 AND expires_at > ?
    ORDER BY expires_at DESC
  `).all(userId, new Date().toISOString()) as TokenBlacklistEntry[];
}

/**
 * Get revocation history for a token
 */
export function getTokenRevocationInfo(token: string): TokenBlacklistEntry | null {
  return db.prepare(`
    SELECT id, token, user_id, revoked, revoked_at, revoke_reason, expires_at
    FROM access_tokens WHERE token = ?
  `).get(token) as TokenBlacklistEntry | null;
}

/**
 * Cleanup expired revoked tokens (can be called periodically)
 */
export function cleanupRevokedTokens(): number {
  try {
    const result = db.prepare(`
      DELETE FROM access_tokens 
      WHERE revoked = 1 AND expires_at < ?
    `).run(new Date().toISOString());
    
    return result.changes;
  } catch (error) {
    console.error('Failed to cleanup revoked tokens:', error);
    return 0;
  }
}

/**
 * Batch revoke tokens by user IDs (for admin use)
 */
export function batchRevokeByUserIds(
  userIds: string[],
  reason: RevokeReason = RevokeReason.ADMIN_REVOCATION
): number {
  if (userIds.length === 0) return 0;
  
  try {
    const placeholders = userIds.map(() => '?').join(',');
    const result = db.prepare(`
      UPDATE access_tokens 
      SET revoked = 1, revoked_at = ?, revoke_reason = ?
      WHERE user_id IN (${placeholders}) AND revoked = 0
    `).run(new Date().toISOString(), reason, ...userIds);
    
    return result.changes;
  } catch (error) {
    console.error('Failed to batch revoke tokens:', error);
    return 0;
  }
}
