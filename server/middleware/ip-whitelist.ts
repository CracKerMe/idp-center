import express from 'express';
import { db } from '../database.js';
import { error, ErrorCode } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

// ─── IPv4 helpers ────────────────────────────────────────────────────────────

/**
 * Convert a dotted-decimal IPv4 string to a 32-bit unsigned integer.
 */
export function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

/**
 * Test whether an IPv4 address falls within a given IPv4 CIDR range.
 * Uses bitwise mask comparison.
 */
export function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(network);
  return (ipInt & mask) === (networkInt & mask);
}

// ─── IPv6 helpers ────────────────────────────────────────────────────────────

/**
 * Expand a shorthand IPv6 address to full 8-group notation.
 * Handles '::' compression and embedded IPv4 addresses.
 */
export function expandIpv6(ip: string): string {
  // Handle '::' — split into left and right halves
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    const middle = Array(missing).fill('0000');
    const all = [...leftGroups, ...middle, ...rightGroups];
    return all.map(g => g.padStart(4, '0')).join(':');
  }
  // Already fully expanded — just zero-pad each group
  return ip.split(':').map(g => g.padStart(4, '0')).join(':');
}

/**
 * Convert a fully-expanded IPv6 address (8 groups) to a BigInt.
 */
export function ipv6ToBigInt(ip: string): bigint {
  return ip
    .split(':')
    .reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group, 16)), 0n);
}

/**
 * Test whether an IPv6 address falls within a given IPv6 CIDR range.
 * Uses BigInt mask comparison.
 */
export function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const ipBig = ipv6ToBigInt(expandIpv6(ip));
  const networkBig = ipv6ToBigInt(expandIpv6(network));
  const mask = prefix === 0 ? 0n : (~0n << BigInt(128 - prefix));
  return (ipBig & mask) === (networkBig & mask);
}

// ─── CIDR parsing ────────────────────────────────────────────────────────────

/** Simple IPv4 format check */
function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = parseInt(p, 10);
    return String(n) === p && n >= 0 && n <= 255;
  });
}

/** Simple IPv6 format check (accepts compressed notation) */
function isValidIpv6(ip: string): boolean {
  // Allow at most one '::'
  const doubleColonCount = (ip.match(/::/g) || []).length;
  if (doubleColonCount > 1) return false;

  const groups = ip.split('::');
  const allGroups = groups.flatMap(g => (g ? g.split(':') : []));
  const maxGroups = doubleColonCount === 1 ? 7 : 8;
  if (allGroups.length > maxGroups) return false;

  return allGroups.every(g => /^[0-9a-fA-F]{1,4}$/.test(g));
}

/**
 * Parse and validate a CIDR string.
 * Returns `{ ip, prefix, version }` on success, or `null` if the format is invalid.
 */
export function parseCidr(cidr: string): { ip: string; prefix: number; version: 4 | 6 } | null {
  const parts = cidr.split('/');
  if (parts.length !== 2) return null;

  const [ip, prefixStr] = parts;
  const prefix = parseInt(prefixStr, 10);

  if (isNaN(prefix) || String(prefix) !== prefixStr) return null;

  if (isValidIpv4(ip) && prefix >= 0 && prefix <= 32) {
    return { ip, prefix, version: 4 };
  }
  if (isValidIpv6(ip) && prefix >= 0 && prefix <= 128) {
    return { ip, prefix, version: 6 };
  }
  return null;
}

// ─── Unified IP-in-CIDR dispatcher ───────────────────────────────────────────

/**
 * Test whether an IP address (IPv4 or IPv6) falls within a given CIDR range.
 * Dispatches to the appropriate IPv4 or IPv6 matcher based on the CIDR version.
 * Returns `false` if the CIDR is invalid or the IP/CIDR versions do not match.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) return false;

  if (parsed.version === 4) {
    if (!isValidIpv4(ip)) return false;
    return isIpv4InCidr(ip, cidr);
  } else {
    if (!isValidIpv6(ip)) return false;
    return isIpv6InCidr(ip, cidr);
  }
}

// ─── Client IP extraction ─────────────────────────────────────────────────────

/**
 * Extract the real client IP from a request.
 * Prefers the first entry in the `X-Forwarded-For` header (set by reverse proxies),
 * falling back to `req.ip` and then `req.socket.remoteAddress`.
 */
export function extractClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const firstIp = (typeof forwarded === 'string' ? forwarded : forwarded[0])
      .split(',')[0]
      .trim();
    if (firstIp) return firstIp;
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * IP whitelist guard middleware.
 *
 * Must be registered after `tenantContext` (which injects `req.tenantId`).
 *
 * Behaviour:
 * - If the tenant has no whitelist entries → call `next()` (allow all).
 * - If the client IP matches any CIDR entry (logical OR) → call `next()`.
 * - Otherwise → respond 403 `IP_NOT_WHITELISTED` and write an audit log entry.
 */
export function ipWhitelistGuard(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const tenantId = req.tenantId;

  const entries = db
    .prepare('SELECT cidr FROM tenant_ip_whitelist WHERE tenant_id = ?')
    .all(tenantId) as { cidr: string }[];

  // No whitelist configured → allow all traffic
  if (entries.length === 0) {
    next();
    return;
  }

  const clientIp = extractClientIp(req);

  const allowed = entries.some(entry => isIpInCidr(clientIp, entry.cidr));

  if (allowed) {
    next();
    return;
  }

  // Blocked — write audit log and return 403
  logAudit(
    null,
    'IP_BLOCKED',
    req,
    JSON.stringify({
      blocked_ip: clientIp,
      tenant_id: tenantId,
      path: req.path,
    }),
    tenantId
  );

  res.status(403).json(error('Access denied: IP not whitelisted', ErrorCode.IP_NOT_WHITELISTED));
}
