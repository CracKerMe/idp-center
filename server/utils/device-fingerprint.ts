import crypto from 'crypto';
import { config } from '../config.js';

/** HMAC(userAgent + ip) — stable per browser/network combo, never reversible to raw IP/UA. */
export function computeDeviceFingerprint(userAgent: string, ip: string): string {
  const salt = config.ENCRYPTION_KEY || config.JWT_SECRET;
  return crypto.createHmac('sha256', salt).update(userAgent + ip).digest('hex');
}
