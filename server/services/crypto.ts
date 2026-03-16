import crypto from 'crypto';
import { config } from '../config';

/** Derive a 32-byte AES key from ENCRYPTION_KEY env var (or JWT_SECRET as fallback). */
export function getEncryptionKey(): Buffer {
  const envKey = config.ENCRYPTION_KEY;
  if (envKey) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  return crypto.createHash('sha256').update(config.JWT_SECRET).digest();
}

/**
 * Encrypt a plaintext token using AES-256-GCM.
 * Returns a colon-delimited string: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
export function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt a token produced by encryptToken. */
export function decryptToken(encrypted: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Invalid encrypted token format');
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Generate a cryptographically random OAuth state parameter (64 hex chars). */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}
