import { db } from '../database.js';

export interface CleanupResult {
  accessTokens: number;
  refreshTokens: number;
  authCodes: number;
  oauthStates: number;
  passwordResets: number;
  trustedDevices: number;
}

export function cleanupExpiredTokens(): CleanupResult {
  const now = new Date().toISOString();
  return {
    accessTokens: db.prepare('DELETE FROM access_tokens WHERE expires_at < ?').run(now).changes,
    refreshTokens: db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ? AND revoked = 1').run(now).changes,
    authCodes: db.prepare('DELETE FROM auth_codes WHERE expires_at < ?').run(now).changes,
    oauthStates: db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(now).changes,
    passwordResets: db.prepare('DELETE FROM password_resets WHERE expires_at < ? AND used = 1').run(now).changes,
    trustedDevices: db.prepare('DELETE FROM trusted_devices WHERE expires_at < ?').run(now).changes,
  };
}
