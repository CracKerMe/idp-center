import * as fs from 'fs';
import { logger } from './logger.js';

// Built-in weak password dictionary (at least 100 entries, all stored lowercase)
const BUILTIN_WEAK_PASSWORDS: string[] = [
  // Most common passwords
  'password', 'password1', 'password123', 'password1234', 'password12345',
  '123456', '1234567', '12345678', '123456789', '1234567890',
  '12345', '123123', '111111', '000000', '654321',
  'qwerty', 'qwerty123', 'qwertyuiop', 'qwerty1', 'qwerty12',
  'abc123', 'abc1234', 'abcdef', 'abcd1234', 'abcd123',
  // Common words
  'monkey', 'master', 'dragon', 'shadow', 'sunshine',
  'princess', 'welcome', 'login', 'admin', 'administrator',
  'letmein', 'iloveyou', 'trustno1', 'superman', 'batman',
  'football', 'baseball', 'soccer', 'hockey', 'basketball',
  'michael', 'jessica', 'ashley', 'jennifer', 'joshua',
  'thomas', 'charlie', 'andrew', 'daniel', 'george',
  'jordan', 'harley', 'ranger', 'dakota', 'cookie',
  'cheese', 'butter', 'coffee', 'orange', 'banana',
  'apple', 'cherry', 'lemon', 'pepper', 'ginger',
  // Keyboard patterns
  'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm', '1q2w3e',
  '1q2w3e4r', '1q2w3e4r5t', 'qazwsx', 'qazwsxedc', 'q1w2e3r4',
  'aaaaaa', 'bbbbbb', 'cccccc', '111222', '112233',
  // Common phrases and patterns
  'pass123', 'pass1234', 'test123', 'test1234', 'user123',
  'hello123', 'hello1234', 'welcome1', 'welcome123', 'changeme',
  'secret', 'secret1', 'secret123', 'mypassword', 'mypass',
  'newpass', 'newpassword', 'oldpassword', 'temppass', 'temp123',
  'root', 'toor', 'guest', 'default', 'system',
  // Number sequences
  '987654', '9876543', '98765432', '987654321', '11111111',
  '22222222', '33333333', '44444444', '55555555', '66666666',
  '77777777', '88888888', '99999999', '00000000', '10203040',
  // Common names and words
  'summer', 'winter', 'spring', 'autumn', 'monday',
  'tuesday', 'friday', 'sunday', 'january', 'december',
  'london', 'paris', 'berlin', 'moscow', 'tokyo',
  'google', 'amazon', 'twitter', 'facebook', 'linkedin',
  'matrix', 'hacker', 'hunter', 'killer', 'master1',
  'dragon1', 'shadow1', 'ninja', 'samurai', 'warrior',
  // Variations
  'p@ssword', 'p@ss123', 'p@ssw0rd', 'passw0rd', 'pa$$word',
  'adm1n', 'r00t', 'l0gin', 'us3r', 'g3st',
  // More common passwords
  'mustang', 'access', 'flower', 'maggie', 'starwars',
  'corvette', 'maverick', 'phoenix', 'thunder', 'lightning',
  'freedom', 'liberty', 'justice', 'america', 'united',
  'computer', 'internet', 'network', 'server', 'database',
];

// Load and merge built-in list with optional custom file from WEAK_PASSWORDS_FILE env var
function loadWeakPasswords(): Set<string> {
  const passwords = new Set(BUILTIN_WEAK_PASSWORDS.map(p => p.toLowerCase()));

  const customFile = process.env.WEAK_PASSWORDS_FILE;
  if (customFile) {
    try {
      const lines = fs.readFileSync(customFile, 'utf-8').split('\n');
      lines.forEach(line => {
        const trimmed = line.trim().toLowerCase();
        if (trimmed) passwords.add(trimmed);
      });
    } catch (err) {
      logger.warn('Failed to load custom weak passwords file', { file: customFile });
    }
  }

  return passwords;
}

export const weakPasswords: Set<string> = loadWeakPasswords();

// Case-insensitive weak password check
export function isWeakPassword(password: string): boolean {
  return weakPasswords.has(password.toLowerCase());
}
