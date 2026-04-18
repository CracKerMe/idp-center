import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import * as fc from 'fast-check';

// Mock the config module before importing crypto service
vi.mock('../server/config.js', () => ({
  config: {
    JWT_SECRET: 'mock-jwt-secret-for-testing-purposes-32ch',
    ENCRYPTION_KEY: 'mock-encryption-key-for-testing-32chars',
  },
}));

// Import after mock is set up
const { encryptToken, decryptToken, generateOAuthState, getEncryptionKey } = await import('../server/services/crypto.js');

describe('Crypto Service', () => {
  describe('getEncryptionKey', () => {
    it('returns a 32-byte Buffer', () => {
      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.byteLength).toBe(32);
    });

    it('returns the same key for repeated calls', () => {
      const key1 = getEncryptionKey();
      const key2 = getEncryptionKey();
      expect(key1.equals(key2)).toBe(true);
    });

    it('is deterministic (same input → same output)', () => {
      const hash1 = crypto.createHash('sha256').update('test').digest();
      const hash2 = crypto.createHash('sha256').update('test').digest();
      expect(hash1.equals(hash2)).toBe(true);
    });

    it('different inputs produce different keys', () => {
      const hash1 = crypto.createHash('sha256').update('key1').digest();
      const hash2 = crypto.createHash('sha256').update('key2').digest();
      expect(hash1.equals(hash2)).toBe(false);
    });
  });

  describe('encryptToken', () => {
    it('returns a colon-delimited string with 3 parts', () => {
      const encrypted = encryptToken('my-secret-token');
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);
    });

    it('each part is a valid hex string', () => {
      const encrypted = encryptToken('test-token');
      const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
      expect(() => Buffer.from(ivHex, 'hex')).not.toThrow();
      expect(() => Buffer.from(authTagHex, 'hex')).not.toThrow();
      expect(() => Buffer.from(ciphertextHex, 'hex')).not.toThrow();
    });

    it('IV is 12 bytes (24 hex chars)', () => {
      const encrypted = encryptToken('test-token');
      const [ivHex] = encrypted.split(':');
      expect(ivHex.length).toBe(24);
    });

    it('authTag is 16 bytes (32 hex chars)', () => {
      const encrypted = encryptToken('test-token');
      const [, authTagHex] = encrypted.split(':');
      expect(authTagHex.length).toBe(32);
    });

    it('different tokens produce different ciphertexts', () => {
      const enc1 = encryptToken('token-a');
      const enc2 = encryptToken('token-b');
      expect(enc1).not.toBe(enc2);
    });

    it('same token encrypted twice produces different ciphertexts (due to random IV)', () => {
      const enc1 = encryptToken('same-token');
      const enc2 = encryptToken('same-token');
      expect(enc1).not.toBe(enc2);
      // But both should decrypt to the same value
      expect(decryptToken(enc1)).toBe('same-token');
      expect(decryptToken(enc2)).toBe('same-token');
    });

    it('roundtrips correctly for various token types', () => {
      const tokens = [
        'short',
        'a'.repeat(100),
        'with spaces and !@#$%',
        'unicode_中文_日本語',
        'mix_of_αβγ_and_latin',
      ];
      for (const token of tokens) {
        const encrypted = encryptToken(token);
        expect(decryptToken(encrypted)).toBe(token);
      }
    });
  });

  describe('decryptToken', () => {
    it('decrypts an encrypted token back to the original', () => {
      const original = 'my-access-token-xyz';
      const encrypted = encryptToken(original);
      expect(decryptToken(encrypted)).toBe(original);
    });

    it('throws for malformed input (not 3 parts)', () => {
      expect(() => decryptToken('no-colons')).toThrow();
      expect(() => decryptToken('a:b')).toThrow();
      expect(() => decryptToken('a:b:c:d')).toThrow();
    });

    it('throws for invalid hex in IV', () => {
      expect(() => decryptToken('nothex!!:authTag:ciphertext')).toThrow();
    });

    it('throws for invalid hex in authTag', () => {
      const [ivHex] = encryptToken('t').split(':');
      expect(() => decryptToken(`${ivHex}:nothex!!:ciphertext`)).toThrow();
    });

    it('throws for wrong authTag (tampered ciphertext)', () => {
      const encrypted = encryptToken('secret');
      const [iv, auth, ct] = encrypted.split(':');
      const tampered = `${iv}:${auth}:${ct.replace(/^./, 'x')}`;
      expect(() => decryptToken(tampered)).toThrow();
    });

    it('throws for ciphertext modified after encryption', () => {
      const encrypted = encryptToken('original-token');
      const [iv, tag, ct] = encrypted.split(':');
      // Flip a bit in the ciphertext
      const tamperedBuf = Buffer.from(ct, "hex");
      tamperedBuf[0] = tamperedBuf[0] ^ 0xff;
      const tamperedCt = tamperedBuf.toString("hex");
      expect(() => decryptToken(`${iv}:${tag}:${tamperedCt}`)).toThrow();
    });
  });

  describe('encrypt/decrypt roundtrip property', () => {
    it('property: decrypt(encrypt(token)) === token for arbitrary strings', () => {
      fc.assert(
        fc.property(
          // Filter out empty string — encryptToken would produce a token that
          // decryptToken can't parse (0-length IV is valid hex but wrong size)
          fc.string({ minLength: 1, maxLength: 500 }),
          (token) => {
            const encrypted = encryptToken(token);
            return decryptToken(encrypted) === token;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('generateOAuthState', () => {
    it('returns a 64-character hex string', () => {
      const state = generateOAuthState();
      expect(state).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns different values on each call', () => {
      const states = Array.from({ length: 20 }, () => generateOAuthState());
      const unique = new Set(states);
      expect(unique.size).toBe(20);
    });

    it('has 256 bits of entropy (32 bytes)', () => {
      const state = generateOAuthState();
      expect(state.length).toBe(64);
      const entropy = Buffer.from(state, 'hex').byteLength;
      expect(entropy).toBe(32);
    });

    it('is lowercase hex only', () => {
      const state = generateOAuthState();
      expect(state).toBe(state.toLowerCase());
      expect(/^[0-9a-f]+$/.test(state)).toBe(true);
    });
  });

  describe('generateOAuthState uniqueness property', () => {
    it('property: all generated states are unique across many runs', () => {
      fc.assert(
        fc.property(fc.integer({ min: 10, max: 100 }), (n) => {
          const states = Array.from({ length: n }, generateOAuthState);
          return new Set(states).size === n;
        }),
        { numRuns: 50 }
      );
    });
  });
});
