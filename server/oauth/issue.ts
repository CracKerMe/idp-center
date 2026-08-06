import crypto from 'crypto';
import { db } from '../database.js';
import { TOKEN_CONFIG } from '../config.js';
import { accessTokens, refreshTokens, users } from '../schema.js';
import { getUserRoleNames, getUserGroupNames } from '../services/rbac.service.js';
import { signAccessToken, signIdToken } from './jwt.js';

type UserRow = typeof users.$inferSelect;

/**
 * Issues an RS256-signed access token (Deploy B — ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md §1.1).
 * The token is signed via server/oauth/jwt.ts and persisted to access_tokens with its SHA-256 hash.
 */
export async function issueAccessToken(user: UserRow, clientId: string, scope: string, tenantId: string, oidcSessionId?: string, cnf?: { jkt: string }, authCtx?: { amr?: string | null; acr?: string | null }, authCodeId?: string): Promise<{ token: string; expiresAt: Date }> {
  // Field names must match JwtUserPayload (server/types/index.ts) — authenticateAdmin
  // and other consumers read req.user.is_admin / req.user.tenant_id, not camelCase.
  const payload: Record<string, any> = { id: user.id, username: user.username, is_admin: user.isAdmin, tenant_id: user.tenantId };
  if (cnf) payload.cnf = cnf;
  if (authCtx?.amr) payload.amr = authCtx.amr.split(',');
  if (authCtx?.acr) payload.acr = authCtx.acr;
  
  const token = await signAccessToken(payload, { expiresInSec: TOKEN_CONFIG.accessTokenExpirySeconds });
  const expiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token,
    tokenHash,
    clientId,
    userId: user.id,
    tenantId,
    subjectType: 'user',
    oidcSessionId: oidcSessionId ?? null,
    authCodeId: authCodeId ?? null,
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
  const payload: Record<string, any> = { sub: clientId, client_id: clientId, sub_type: 'client', tenant_id: tenantId, scope };
  if (cnf) payload.cnf = cnf;
  
  const token = await signAccessToken(payload, { expiresInSec: TOKEN_CONFIG.accessTokenExpirySeconds });
  const expiresAt = new Date(Date.now() + TOKEN_CONFIG.accessTokenExpiryMs);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token,
    tokenHash,
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
  authCodeId?: string;
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
    authCodeId: opts.authCodeId ?? null,
    expiresAt,
    scope: opts.scope,
    familyId,
    rememberMe: opts.rememberMe ?? false,
  });

  return { token, expiresAt, familyId };
}

export async function issueIdToken(user: UserRow, opts: { clientId: string; scope: string; nonce?: string | null; sid?: string; authTime?: Date; amr?: string | null; acr?: string | null }): Promise<string> {
  const payload: Record<string, any> = {
    sub: user.id,
  };
  if (opts.nonce) payload.nonce = opts.nonce;
  if (opts.sid) payload.sid = opts.sid;
  if (opts.authTime) payload.auth_time = Math.floor(opts.authTime.getTime() / 1000);
  if (opts.amr) payload.amr = opts.amr.split(',');
  if (opts.acr) payload.acr = opts.acr;
  if (opts.scope.includes('email')) payload.email = user.email;
  if (opts.scope.includes('profile')) {
    payload.name = user.fullName || user.username;
    payload.preferred_username = user.username;
  }
  const tenantId = user.tenantId || 'default';
  if (opts.scope.includes('roles')) payload.roles = await getUserRoleNames(user.id, tenantId);
  if (opts.scope.includes('groups')) payload.groups = await getUserGroupNames(user.id, tenantId);
  
  return signIdToken(payload, { audience: opts.clientId, expiresInSec: TOKEN_CONFIG.accessTokenExpirySeconds });
}
