import { describe, it, expect } from 'vitest';
import { validatePasswordStrength } from '../server/utils/password.js';

// Actual scoring (verified by running the function):
//   length >= 8  → +1
//   has lowercase → +1
//   has uppercase → +1
//   has digit    → +1
//   has special  → +1
// valid = score >= 3
// Score = count of criteria met, no upper cap

describe('Password Strength', () => {
  describe('score calculation', () => {
    it('scores 0 for empty string', () => {
      const result = validatePasswordStrength('');
      expect(result.score).toBe(0);
      expect(result.valid).toBe(false);
    });

    it('scores 1 for 6-char lowercase only', () => {
      // length<8: no bonus; lowercase: +1 → score = 1
      const result = validatePasswordStrength('abcdef');
      expect(result.score).toBe(1);
      expect(result.valid).toBe(false);
    });

    it('scores 2 for 8-char lowercase only', () => {
      // length>=8: +1, lowercase: +1 → score = 2
      const result = validatePasswordStrength('abcdefgh');
      expect(result.score).toBe(2);
      expect(result.valid).toBe(false);
    });

    it('scores 3 for 8-char lowercase + uppercase', () => {
      // length: +1, lower: +1, upper: +1 → score = 3
      const result = validatePasswordStrength('Abcdefgh');
      expect(result.score).toBe(3);
      expect(result.valid).toBe(true); // 3 >= 3
    });

    it('scores 4 for 8-char lowercase + uppercase + digit', () => {
      // length: +1, lower: +1, upper: +1, digit: +1 → score = 4
      const result = validatePasswordStrength('Abcdefg1');
      expect(result.score).toBe(4);
      expect(result.valid).toBe(true);
    });

    it('scores 5 for 8-char password meeting all 5 criteria', () => {
      // length: +1, lower: +1, upper: +1, digit: +1, special: +1 → score = 5
      const result = validatePasswordStrength('Abcdefg1!');
      expect(result.score).toBe(5);
      expect(result.valid).toBe(true);
    });

    it('scores 5 for a longer password meeting all 5 criteria', () => {
      const result = validatePasswordStrength('A1b!cdefghi');
      expect(result.score).toBe(5);
      expect(result.valid).toBe(true);
    });
  });

  describe('length validation', () => {
    it('scores 4 for short password meeting all 4 character-type criteria', () => {
      // length<8: +0, lower+upper+digit+special: +4 → score = 4
      const result = validatePasswordStrength('Ab1!xyz');
      expect(result.score).toBe(4);
      expect(result.valid).toBe(true); // 4 >= 3
    });

    it('scores 5 for a long password with all criteria', () => {
      const result = validatePasswordStrength('A1b!cdefghi');
      expect(result.score).toBe(5);
      expect(result.valid).toBe(true);
    });
  });

  describe('character type requirements', () => {
    it('requires lowercase letters (adds error)', () => {
      const result = validatePasswordStrength('ABCDEFG1!');
      expect(result.errors).toContain('Password must contain lowercase letters');
    });

    it('requires uppercase letters (adds error)', () => {
      const result = validatePasswordStrength('abcdefg1!');
      expect(result.errors).toContain('Password must contain uppercase letters');
    });

    it('requires numbers (adds error)', () => {
      const result = validatePasswordStrength('Abcdefgh!');
      expect(result.errors).toContain('Password must contain numbers');
    });

    it('requires special characters (adds error)', () => {
      const result = validatePasswordStrength('Abcdefg12');
      expect(result.errors).toContain('Password must contain special characters');
    });

    it('full-strength password has no errors', () => {
      const result = validatePasswordStrength('P@ssw0rd!');
      expect(result.errors.length).toBe(0);
    });
  });

  describe('errors array', () => {
    it('returns at most 3 errors', () => {
      const result = validatePasswordStrength('');
      expect(result.errors.length).toBeLessThanOrEqual(3);
    });

    it('errors array is empty for full-strength password', () => {
      const result = validatePasswordStrength('Ab1!cdefg');
      expect(result.errors.length).toBe(0);
    });

    it('errors array order is deterministic', () => {
      const result1 = validatePasswordStrength('ABCDEF');
      const result2 = validatePasswordStrength('ABCDEF');
      expect(result1.errors).toEqual(result2.errors);
    });
  });

  describe('valid flag', () => {
    it('valid is true when score >= 3', () => {
      expect(validatePasswordStrength('Abcdefgh').valid).toBe(true);   // score 3
      expect(validatePasswordStrength('Abcdefg1').valid).toBe(true);   // score 4
      expect(validatePasswordStrength('Ab1!xyz').valid).toBe(true);    // score 4
    });

    it('valid is false when score < 3', () => {
      expect(validatePasswordStrength('abcdefgh').valid).toBe(false); // score 2
      expect(validatePasswordStrength('abcdef').valid).toBe(false);  // score 1
      expect(validatePasswordStrength('').valid).toBe(false);        // score 0
    });
  });

  describe('edge cases', () => {
    it('handles unicode characters', () => {
      const result = validatePasswordStrength('Pass猫1!');
      expect(typeof result.score).toBe('number');
      expect(result.errors).toBeDefined();
    });

    it('handles very long passwords with all criteria', () => {
      const long = 'A1b!'.repeat(50);
      const result = validatePasswordStrength(long);
      expect(result.score).toBe(5);
      expect(result.valid).toBe(true);
    });

    it('returns correct shape', () => {
      const result = validatePasswordStrength('test');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });
});
