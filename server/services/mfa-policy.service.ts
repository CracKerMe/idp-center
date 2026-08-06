import { db } from '../database.js';
import { tenantMfaPolicies, users } from '../schema.js';
import { eq } from 'drizzle-orm';

export interface TenantMfaPolicy {
  required: boolean;
  requiredForAdmins: boolean;
  allowedTypes: string[];
  rememberDeviceDays: number;
}

export const DEFAULT_MFA_POLICY: TenantMfaPolicy = {
  required: false,
  requiredForAdmins: true,
  allowedTypes: ['totp', 'webauthn', 'email'],
  rememberDeviceDays: 30,
};

export async function getTenantMfaPolicy(tenantId: string): Promise<TenantMfaPolicy> {
  const [row] = await db
    .select()
    .from(tenantMfaPolicies)
    .where(eq(tenantMfaPolicies.tenantId, tenantId))
    .limit(1);

  if (!row) return { ...DEFAULT_MFA_POLICY };

  return {
    required: row.required ?? false,
    requiredForAdmins: row.requiredForAdmins ?? true,
    allowedTypes: (row.allowedTypes || 'totp,webauthn,email').split(',').map(s => s.trim()).filter(Boolean),
    rememberDeviceDays: row.rememberDeviceDays ?? 30,
  };
}

export async function upsertTenantMfaPolicy(tenantId: string, patch: Partial<TenantMfaPolicy>): Promise<TenantMfaPolicy> {
  const current = await getTenantMfaPolicy(tenantId);
  const next = { ...current, ...patch };

  await db.insert(tenantMfaPolicies).values({
    tenantId,
    required: next.required,
    requiredForAdmins: next.requiredForAdmins,
    allowedTypes: next.allowedTypes.join(','),
    rememberDeviceDays: next.rememberDeviceDays,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: tenantMfaPolicies.tenantId,
    set: {
      required: next.required,
      requiredForAdmins: next.requiredForAdmins,
      allowedTypes: next.allowedTypes.join(','),
      rememberDeviceDays: next.rememberDeviceDays,
      updatedAt: new Date(),
    },
  });

  return next;
}

/** Whether this user is required to have at least one active MFA factor enrolled. */
export async function isMfaRequiredForUser(userId: string, tenantId: string): Promise<boolean> {
  const policy = await getTenantMfaPolicy(tenantId);
  if (policy.required) return true;
  if (!policy.requiredForAdmins) return false;

  const [user] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).limit(1);
  return !!user?.isAdmin;
}
