export interface PasswordStrength {
  score: number; // 0-4
  valid: boolean;
  errors: string[];
}

/**
 * @deprecated 请使用 PasswordPolicyEngine.validatePassword()
 * @see validatePassword from 'server/services/password-policy.service.ts'
 *
 * Kept for backward compatibility. Use `validatePassword` from
 * `server/services/password-policy.service.ts` for tenant-aware policy enforcement.
 */
export function validatePasswordStrength(password: string): PasswordStrength {
  const errors: string[] = [];
  let score = 0;

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  } else {
    score++;
  }

  if (/[a-z]/.test(password)) score++;
  else errors.push('Password must contain lowercase letters');

  if (/[A-Z]/.test(password)) score++;
  else errors.push('Password must contain uppercase letters');

  if (/[0-9]/.test(password)) score++;
  else errors.push('Password must contain numbers');

  if (/[^a-zA-Z0-9]/.test(password)) score++;
  else errors.push('Password must contain special characters');

  return {
    score,
    valid: score >= 3,
    errors: errors.slice(0, 3),
  };
}
