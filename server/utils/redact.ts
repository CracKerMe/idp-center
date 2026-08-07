const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}\b/g;
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;

/**
 * Strips PII (emails, IP addresses, phone-shaped digit runs) from text before it's sent to
 * the Claude API for audit summarization / compliance checks (implementation plan §3.3
 * "红线: 用户 PII 送模型前必须脱敏"). User IDs (opaque UUIDs) and tenant IDs are left intact —
 * they're needed for the model's output to be actionable and aren't personally identifying
 * on their own.
 */
export function redactPII(text: string): string {
  return text
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(IPV6_RE, '[IP]')
    .replace(IPV4_RE, '[IP]')
    .replace(PHONE_RE, '[PHONE]');
}

/** Deep-redacts every string value in a plain object/array, used before JSON.stringify → prompt. */
export function redactObject<T>(value: T): T {
  if (typeof value === 'string') return redactPII(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactObject) as unknown as T;
  // Dates aren't PII and have no own-enumerable properties — falling through to the generic
  // object branch below would silently flatten every timestamp to `{}` (Object.entries on a
  // Date returns nothing), so it must short-circuit here rather than after.
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactObject(v);
    return out as T;
  }
  return value;
}
