import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../database.js';
import { config, TOKEN_CONFIG } from '../config.js';
import { accessTokens, refreshTokens, users } from '../schema.js';

type UserRow = typeof users.$inferSelect;

/**
 * Single signing entrypoint for OAuth access/id tokens. Still HS256 via
 * jsonwebtoken (server/oauth/jwt.ts's RS256 signer takes over at Deploy B —
 * ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md §1.1 release B).
 */
export async function issueAccessToken(user: UserRow, clientId: string, scope: string, tenantId: string, oidcSessionId?: string, cnf?: { jkt: string }): Promise<{ token: string; expiresAt: Date }> {
  // Field names must match JwtUserPayload (server/types/index.ts) — authenticateAdmin
  // and other consumers read req.user.is_admin / req.user.tenant_id, not camelCase.
  const payload: Record<string, any> = { id: user.id, username: user.username, is_admin: user.isAdmin, tenant_id: user.tenantId, jti: crypto.randomUUID() };
  if (cnf) payload.cnf = cnf;
  const token = jwt.sign(
    payload,
    config.JWT_SECRET,
    { expiresIn: TOKEN_CONFIG.accessTokenExpiry }
  );
  const expiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token,
    clientId,
    userId: user.id,
    tenantId,
    subjectType: 'user',
    oidcSessionId: oidcSessionId ?? null,
    expiresAt,
    scope,
  });
  return { token, expiresAt };
}

/**
 * Machine token for the client_credentials grant. There is no end user, so the
 * subject is the client itself. access_tokens.user_id has no FK constraint,
 * so writing client_id there is valid — token-blacklist.ts needs no changes.
 */
export async function issueClientAccessToken(clientId: string, scope: string, tenantId: string, cnf?: { jkt: string }): Promise<{ token: string; expiresAt: Date }> {
  const payload: Record<string, any> = { sub: clientId, client_id: clientId, sub_type: 'client', tenant_id: tenantId, scope, jti: crypto.randomUUID() };
  if (cnf) payload.cnf = cnf;
  const token = jwt.sign(
    payload,
    config.JWT_SECRET,
    { expiresIn: TOKEN_CONFIG.accessTokenExpiry }
  );
  const expiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token,
    clientId,
    userId: clientId,
    tenantId,
    subjectType: 'client',
    expiresAt,
    scope,
  });
  return { token, expiresAt };
}

export async function issueRefreshToken(opts: {
  userId: string;
  clientId: string;
  tenantId: string;
  scope: string;
  familyId?: string;
  rememberMe?: boolean;
  oidcSessionId?: string;
}): Promise<{ token: string; expiresAt: Date; familyId: string }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresMs = opts.rememberMe ? TOKEN_CONFIG.refreshTokenRememberMeMs : TOKEN_CONFIG.refreshTokenExpiryMs;
  const expiresAt = new Date(Date.now() + expiresMs);
  const familyId = opts.familyId ?? crypto.randomUUID();

  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    token,
    userId: opts.userId,
    clientId: opts.clientId,
    tenantId: opts.tenantId,
    oidcSessionId: opts.oidcSessionId ?? null,
    expiresAt,
    scope: opts.scope,
    familyId,
    rememberMe: opts.rememberMe ?? false,
  });

  return { token, expiresAt, familyId };
}

export function issueIdToken(user: UserRow, opts: { clientId: string; scope: string; nonce?: string | null; sid?: string; authTime?: Date }): string {
  const payload: Record<string, any> = {
    iss: config.APP_URL,
    sub: user.id,
    aud: opts.clientId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_CONFIG.accessTokenExpirySeconds,
    iat: Math.floor(Date.now() / 1000),
  };
  if (opts.nonce) payload.nonce = opts.nonce;
  if (opts.sid) payload.sid = opts.sid;
  if (opts.authTime) payload.auth_time = Math.floor(opts.authTime.getTime() / 1000);
  if (opts.scope.includes('email')) payload.email = user.email;
  if (opts.scope.includes('profile')) {
    payload.name = user.fullName || user.username;
    payload.preferred_username = user.username;
  }
  return jwt.sign(payload, config.JWT_SECRET);
}
