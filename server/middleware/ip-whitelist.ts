import express from 'express';
import { db } from '../database.js';
import { error, ErrorCode } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { AuditAction } from '../utils/audit-actions.js';
import { tenantIpWhitelist } from '../schema.js';
import { eq } from 'drizzle-orm';

// ─── IPv4 helpers ────────────────────────────────────────────────────────────

export function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

export function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(network);
  return (ipInt & mask) === (networkInt & mask);
}

// ─── IPv6 helpers ────────────────────────────────────────────────────────────

export function expandIpv6(ip: string): string {
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    const middle = Array(missing).fill('0000');
    const all = [...leftGroups, ...middle, ...rightGroups];
    return all.map(g => g.padStart(4, '0')).join(':');
  }
  return ip.split(':').map(g => g.padStart(4, '0')).join(':');
}

export function ipv6ToBigInt(ip: string): bigint {
  return ip
    .split(':')
    .reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group, 16)), 0n);
}

export function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const ipBig = ipv6ToBigInt(expandIpv6(ip));
  const networkBig = ipv6ToBigInt(expandIpv6(network));
  const mask = prefix === 0 ? 0n : (~0n << BigInt(128 - prefix));
  return (ipBig & mask) === (networkBig & mask);
}

// ─── CIDR parsing ────────────────────────────────────────────────────────────

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = parseInt(p, 10);
    return String(n) === p && n >= 0 && n <= 255;
  });
}

function isValidIpv6(ip: string): boolean {
  const doubleColonCount = (ip.match(/::/g) || []).length;
  if (doubleColonCount > 1) return false;

  const groups = ip.split('::');
  const allGroups = groups.flatMap(g => (g ? g.split(':') : []));
  const maxGroups = doubleColonCount === 1 ? 7 : 8;
  if (allGroups.length > maxGroups) return false;

  return allGroups.every(g => /^[0-9a-fA-F]{1,4}$/.test(g));
}

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

export async function ipWhitelistGuard(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const tenantId = req.tenantId;

    const entries = await db
      .select({ cidr: tenantIpWhitelist.cidr })
      .from(tenantIpWhitelist)
      .where(eq(tenantIpWhitelist.tenantId, tenantId));

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

    await logAudit({ req, action: AuditAction.IP_BLOCKED, details: JSON.stringify({
        blocked_ip: clientIp,
        tenant_id: tenantId,
        path: req.path,
      }), tenantId: tenantId });

    res.status(403).json(error('Access denied: IP not whitelisted', ErrorCode.IP_NOT_WHITELISTED));
  } catch (err) {
    next(err);
  }
}
