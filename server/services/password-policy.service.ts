import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { db } from '../database.js';
import { ErrorCode } from '../utils/response.js';
import { isWeakPassword } from '../utils/weak-passwords.js';
import { tenantPasswordPolicies, passwordHistory } from '../schema.js';
import { eq, desc, lt, sql, count } from 'drizzle-orm';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Tenant-level password policy configuration (read from DB or defaults) */
export interface TenantPasswordPolicy {
  min_length: number;
  history_count: number;
  rotation_enabled: boolean;
  rotation_period_days: number;
}

/** A single policy violation */
export interface PolicyViolation {
  code: string;
  message: string;
}

/** Result of a password validation */
export interface PolicyValidationResult {
  valid: boolean;
  violations: PolicyViolation[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_PASSWORD_POLICY: TenantPasswordPolicy = {
  min_length: 8,
  history_count: 5,
  rotation_enabled: false,
  rotation_period_days: 90,
};

// ─── Policy Retrieval ─────────────────────────────────────────────────────────

export async function getTenantPasswordPolicy(tenantId: string): Promise<TenantPasswordPolicy> {
  const [row] = await db
    .select({
      minLength: tenantPasswordPolicies.minLength,
      historyCount: tenantPasswordPolicies.historyCount,
      rotationEnabled: tenantPasswordPolicies.rotationEnabled,
      rotationPeriodDays: tenantPasswordPolicies.rotationPeriodDays,
    })
    .from(tenantPasswordPolicies)
    .where(eq(tenantPasswordPolicies.tenantId, tenantId))
    .limit(1);

  if (!row) {
    return { ...DEFAULT_PASSWORD_POLICY };
  }

  return {
    min_length: row.minLength,
    history_count: row.historyCount,
    rotation_enabled: row.rotationEnabled ?? false,
    rotation_period_days: row.rotationPeriodDays,
  };
}

// ─── Password Validation ──────────────────────────────────────────────────────

export async function validatePassword(
  password: string,
  userId: string | null,
  tenantId: string
): Promise<PolicyValidationResult> {
  const policy = await getTenantPasswordPolicy(tenantId);
  const violations: PolicyViolation[] = [];

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

  if (isWeakPassword(password)) {
    violations.push({
      code: ErrorCode.PASSWORD_TOO_COMMON,
      message: '密码过于常见，请使用更复杂的密码',
    });
  }

  if (userId !== null) {
    const historyRows = await db
      .select({ passwordHash: passwordHistory.passwordHash })
      .from(passwordHistory)
      .where(eq(passwordHistory.userId, userId))
      .orderBy(desc(passwordHistory.createdAt))
      .limit(policy.history_count);

    const recentlyUsed = historyRows.some(row =>
      bcrypt.compareSync(password, row.passwordHash)
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

export async function recordPasswordHistory(
  userId: string,
  passwordHash: string,
  tenantId: string
): Promise<void> {
  const policy = await getTenantPasswordPolicy(tenantId);

  await db.insert(passwordHistory).values({
    id: crypto.randomUUID(),
    userId,
    passwordHash,
    tenantId,
  });

  // Delete records exceeding the history_count limit (keep most recent N)
  await db.execute(sql`
    DELETE FROM password_history
    WHERE user_id = ${userId} AND id NOT IN (
      SELECT id FROM password_history
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${policy.history_count}
    )
  `);
}

// ─── Password Expiry ──────────────────────────────────────────────────────────

export async function isPasswordExpired(
  passwordChangedAt: string | null,
  tenantId: string
): Promise<{ expired: boolean; expiresAt: string | null }> {
  const policy = await getTenantPasswordPolicy(tenantId);

  if (!policy.rotation_enabled) {
    return { expired: false, expiresAt: null };
  }

  if (passwordChangedAt === null) {
    return { expired: true, expiresAt: null };
  }

  const changedAtMs = new Date(passwordChangedAt).getTime();
  const expiresAtMs = changedAtMs + policy.rotation_period_days * 86400 * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const expired = Date.now() >= expiresAtMs;

  return { expired, expiresAt };
}
