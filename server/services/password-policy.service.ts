import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { db } from '../database.js';
import { ErrorCode } from '../utils/response.js';
import { isWeakPassword } from '../utils/weak-passwords.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Tenant-level password policy configuration (read from DB or defaults) */
export interface TenantPasswordPolicy {
  min_length: number;           // Minimum password length, default 8
  history_count: number;        // Number of historical passwords to check, default 5
  rotation_enabled: boolean;    // Whether password rotation is enabled, default false
  rotation_period_days: number; // Rotation period in days, default 90
}

/** A single policy violation */
export interface PolicyViolation {
  code: string;    // Corresponds to an ErrorCode enum value
  message: string; // Human-readable error description
}

/** Result of a password validation */
export interface PolicyValidationResult {
  valid: boolean;
  violations: PolicyViolation[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** System-wide default password policy (used when tenant has no custom config) */
export const DEFAULT_PASSWORD_POLICY: TenantPasswordPolicy = {
  min_length: 8,
  history_count: 5,
  rotation_enabled: false,
  rotation_period_days: 90,
};

// ─── Policy Retrieval ─────────────────────────────────────────────────────────

/**
 * Retrieve the password policy for a given tenant.
 * Falls back to DEFAULT_PASSWORD_POLICY if no custom policy is configured.
 */
export function getTenantPasswordPolicy(tenantId: string): TenantPasswordPolicy {
  const row = db
    .prepare(
      'SELECT min_length, history_count, rotation_enabled, rotation_period_days FROM tenant_password_policies WHERE tenant_id = ?'
    )
    .get(tenantId) as
    | {
        min_length: number;
        history_count: number;
        rotation_enabled: number; // SQLite stores booleans as 0/1
        rotation_period_days: number;
      }
    | undefined;

  if (!row) {
    return { ...DEFAULT_PASSWORD_POLICY };
  }

  return {
    min_length: row.min_length,
    history_count: row.history_count,
    rotation_enabled: row.rotation_enabled === 1,
    rotation_period_days: row.rotation_period_days,
  };
}

// ─── Password Validation ──────────────────────────────────────────────────────

/**
 * Validate a password against the tenant's policy.
 *
 * Performs the full validation chain:
 *   1. Strength checks (uppercase, lowercase, digit, special char, length) — collects ALL violations
 *   2. Weak password detection via isWeakPassword()
 *   3. History comparison via bcrypt.compareSync when userId is not null
 *
 * @param password  The plaintext password to validate
 * @param userId    The user's ID (null for registration — no history to check)
 * @param tenantId  The tenant ID used to look up the policy
 */
export function validatePassword(
  password: string,
  userId: string | null,
  tenantId: string
): PolicyValidationResult {
  const policy = getTenantPasswordPolicy(tenantId);
  const violations: PolicyViolation[] = [];

  // ── 1. Strength checks (collect ALL, no early return) ──────────────────────

  if (password.length < policy.min_length) {
    violations.push({
      code: ErrorCode.PASSWORD_TOO_SHORT,
      message: `密码长度不能少于 ${policy.min_length} 个字符`,
    });
  }

  if (!/[A-Z]/.test(password)) {
    violations.push({
      code: ErrorCode.PASSWORD_MISSING_UPPERCASE,
      message: '密码必须包含至少一个大写字母',
    });
  }

  if (!/[a-z]/.test(password)) {
    violations.push({
      code: ErrorCode.PASSWORD_MISSING_LOWERCASE,
      message: '密码必须包含至少一个小写字母',
    });
  }

  if (!/[0-9]/.test(password)) {
    violations.push({
      code: ErrorCode.PASSWORD_MISSING_DIGIT,
      message: '密码必须包含至少一个数字',
    });
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    violations.push({
      code: ErrorCode.PASSWORD_MISSING_SPECIAL,
      message: '密码必须包含至少一个特殊符号',
    });
  }

  // ── 2. Weak password detection ─────────────────────────────────────────────

  if (isWeakPassword(password)) {
    violations.push({
      code: ErrorCode.PASSWORD_TOO_COMMON,
      message: '密码过于常见，请使用更复杂的密码',
    });
  }

  // ── 3. History comparison (only when userId is provided) ───────────────────

  if (userId !== null) {
    const historyRows = db
      .prepare(
        `SELECT password_hash FROM password_history
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, policy.history_count) as { password_hash: string }[];

    const recentlyUsed = historyRows.some(row =>
      bcrypt.compareSync(password, row.password_hash)
    );

    if (recentlyUsed) {
      violations.push({
        code: ErrorCode.PASSWORD_RECENTLY_USED,
        message: `密码不能与最近 ${policy.history_count} 次使用的密码相同`,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ─── Password History ─────────────────────────────────────────────────────────

/**
 * Record a new password hash in the user's password history.
 *
 * Inserts the new record, then deletes any records beyond the tenant's
 * history_count limit (keeping only the most recent N entries).
 *
 * Should be called by the business layer AFTER a successful password change,
 * not inside validatePassword.
 *
 * @param userId        The user's ID
 * @param passwordHash  The bcrypt hash of the new password
 * @param tenantId      The tenant ID used to look up the history_count limit
 */
export function recordPasswordHistory(
  userId: string,
  passwordHash: string,
  tenantId: string
): void {
  const policy = getTenantPasswordPolicy(tenantId);

  // Insert new record
  db.prepare(
    'INSERT INTO password_history (id, user_id, password_hash, tenant_id) VALUES (?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, passwordHash, tenantId);

  // Delete records exceeding the history_count limit (keep most recent N)
  db.prepare(
    `DELETE FROM password_history
     WHERE user_id = ? AND id NOT IN (
       SELECT id FROM password_history
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?
     )`
  ).run(userId, userId, policy.history_count);
}

// ─── Password Expiry ──────────────────────────────────────────────────────────

/**
 * Check whether a user's password has expired based on the tenant's rotation policy.
 *
 * @param passwordChangedAt  ISO timestamp of the last password change (or null)
 * @param tenantId           The tenant ID used to look up the rotation policy
 * @returns  { expired: boolean; expiresAt: string | null }
 *           - If rotation is disabled, always returns { expired: false, expiresAt: null }
 *           - If passwordChangedAt is null and rotation is enabled, treats as expired
 */
export function isPasswordExpired(
  passwordChangedAt: string | null,
  tenantId: string
): { expired: boolean; expiresAt: string | null } {
  const policy = getTenantPasswordPolicy(tenantId);

  // Rotation not enabled — never expired
  if (!policy.rotation_enabled) {
    return { expired: false, expiresAt: null };
  }

  // No recorded change date — treat as expired when rotation is enabled
  if (passwordChangedAt === null) {
    return { expired: true, expiresAt: null };
  }

  const changedAtMs = new Date(passwordChangedAt).getTime();
  const expiresAtMs = changedAtMs + policy.rotation_period_days * 86400 * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const expired = Date.now() >= expiresAtMs;

  return { expired, expiresAt };
}
