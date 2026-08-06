import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type express from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../database.js';
import { config } from '../config.js';
import { encryptToken } from './crypto.js';
import { users, linkedAccounts, accessTokens, sessions, refreshTokens, authCodes } from '../schema.js';
import { assignRoleToUser } from './rbac.service.js';

export interface FederatedProfile {
  email: string | null;
  emailVerified: boolean;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface FindOrLinkOptions {
  /** Link to an existing same-tenant user by verified email instead of always creating a new one. */
  linkByVerifiedEmail?: boolean;
  /** When false, an unrecognized identity is rejected rather than auto-provisioned. */
  jitProvisioning?: boolean;
  /** Role names (already existing in this tenant) to assign to newly created users. */
  defaultRoleIds?: string[];
  /** Provider-side token to keep (e.g. GitHub's OAuth token) — encrypted at rest. */
  providerAccessToken?: string;
}

type UserRow = typeof users.$inferSelect;

/**
 * Generalizes the account-linking logic that used to live only in server/routes/github.ts
 * (findOrCreateUserFromGitHub). That version silently ignored tenant_id: the email lookup
 * and the new-user insert both fell through to the tenantId column's default, so a GitHub
 * account could end up linked to — or colliding with — a user in the wrong tenant. Every
 * lookup and insert here is explicitly scoped to `tenantId`.
 */
export async function findOrLinkUser(
  tenantId: string,
  provider: string,
  providerUserId: string,
  profile: FederatedProfile,
  opts: FindOrLinkOptions = {}
): Promise<UserRow | null> {
  const now = new Date();

  const [existingLink] = await db
    .select({ userId: linkedAccounts.userId })
    .from(linkedAccounts)
    .where(and(
      eq(linkedAccounts.provider, provider),
      eq(linkedAccounts.providerUserId, providerUserId),
      eq(linkedAccounts.tenantId, tenantId),
    ))
    .limit(1);

  if (existingLink) {
    await db.update(linkedAccounts).set({
      providerUsername: profile.username,
      accessToken: opts.providerAccessToken ? encryptToken(opts.providerAccessToken) : undefined,
      updatedAt: now,
    }).where(and(
      eq(linkedAccounts.provider, provider),
      eq(linkedAccounts.providerUserId, providerUserId),
      eq(linkedAccounts.tenantId, tenantId),
    ));

    const [user] = await db.select().from(users).where(eq(users.id, existingLink.userId)).limit(1);
    return user ?? null;
  }

  if (opts.linkByVerifiedEmail && profile.email && profile.emailVerified) {
    const [userByEmail] = await db.select().from(users).where(and(
      eq(users.email, profile.email),
      eq(users.tenantId, tenantId),
    )).limit(1);

    if (userByEmail) {
      await db.insert(linkedAccounts).values({
        id: crypto.randomUUID(),
        userId: userByEmail.id,
        provider,
        providerUserId,
        providerUsername: profile.username,
        tenantId,
        accessToken: opts.providerAccessToken ? encryptToken(opts.providerAccessToken) : null,
      });
      return userByEmail;
    }
  }

  if (opts.jitProvisioning === false) return null;

  let username = profile.username || `user_${providerUserId}`;
  const [usernameConflict] = await db.select({ id: users.id }).from(users).where(and(
    eq(users.username, username),
    eq(users.tenantId, tenantId),
  )).limit(1);
  if (usernameConflict) {
    username = `${username}_${crypto.randomBytes(2).toString('hex')}`;
  }

  const placeholderPasswordHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
  const newUserId = crypto.randomUUID();

  await db.insert(users).values({
    id: newUserId,
    username,
    email: profile.email ?? '',
    passwordHash: placeholderPasswordHash,
    fullName: profile.displayName || null,
    avatarUrl: profile.avatarUrl || null,
    tenantId,
    isActive: true,
    isAdmin: false,
    emailVerified: profile.emailVerified,
    emailVerifiedAt: profile.emailVerified ? now : null,
  });

  await db.insert(linkedAccounts).values({
    id: crypto.randomUUID(),
    userId: newUserId,
    provider,
    providerUserId,
    providerUsername: profile.username,
    tenantId,
    accessToken: opts.providerAccessToken ? encryptToken(opts.providerAccessToken) : null,
  });

  for (const roleId of opts.defaultRoleIds ?? []) {
    await assignRoleToUser(newUserId, roleId, tenantId).catch(() => {});
  }

  const [newUser] = await db.select().from(users).where(eq(users.id, newUserId)).limit(1);
  return newUser ?? null;
}

interface MintedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

/** Shared token/session minting for every federated login path (redirect-based or direct-form). */
async function mintTokensForUser(user: UserRow, req: express.Request): Promise<MintedTokens> {
  const tenantId = user.tenantId || 'default';
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.isAdmin, tenant_id: tenantId },
    config.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db.insert(accessTokens).values({
    id: crypto.randomUUID(),
    token: accessToken,
    clientId: 'system',
    userId: user.id,
    tenantId,
    expiresAt: accessExpiresAt,
  });

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const sessionId = crypto.randomUUID();
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    deviceInfo: userAgent,
    ipAddress: ip,
  });

  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    token: refreshToken,
    userId: user.id,
    tenantId,
    expiresAt: refreshExpiresAt,
  });

  return { accessToken, refreshToken, sessionId };
}

/**
 * Shared tail end of every redirect-based federated login (GitHub, SAML, OIDC RP): issues
 * real tokens server-side, then hands back a one-time exchange code rather than putting the
 * access/refresh token directly in the redirect URL (which would leak into browser history
 * and Referer headers). The SPA immediately trades that code for tokens via
 * POST /api/auth/federation/exchange. Mirrors the pattern server/routes/github.ts already
 * used, generalized so SAML and OIDC RP don't have to duplicate it.
 */
export async function issueFederatedSession(user: UserRow, req: express.Request): Promise<{ exchangeCode: string; sessionId: string }> {
  const { sessionId } = await mintTokensForUser(user, req);
  const tenantId = user.tenantId || 'default';

  const exchangeCode = crypto.randomBytes(32).toString('hex');
  await db.insert(authCodes).values({
    id: crypto.randomUUID(),
    code: exchangeCode,
    clientId: 'federation-oauth',
    userId: user.id,
    tenantId,
    redirectUri: '/',
    expiresAt: new Date(Date.now() + 60 * 1000),
    scope: 'federation_login',
  });

  return { exchangeCode, sessionId };
}

/** Direct (non-redirect) login result — used by LDAP, where the credentials arrive via a
 * same-page form POST rather than a third-party redirect, so there's no browser-history
 * exposure risk and no need for the one-time exchange-code indirection. */
export async function issueDirectLoginResult(user: UserRow, req: express.Request) {
  const { accessToken, refreshToken, sessionId } = await mintTokensForUser(user, req);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer' as const,
    session_id: sessionId,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.isAdmin,
      otp_enabled: user.otpEnabled,
      tenant_id: user.tenantId,
    },
  };
}

/** Backfills linked_accounts.tenant_id from the linked user's tenant, idempotently. */
export async function migrateLegacyLinkedAccounts(): Promise<number> {
  const rows = await db
    .select({ id: linkedAccounts.id, userId: linkedAccounts.userId })
    .from(linkedAccounts)
    .where(isNull(linkedAccounts.tenantId));

  let migrated = 0;
  for (const row of rows) {
    const [user] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user) continue;
    await db.update(linkedAccounts).set({ tenantId: user.tenantId || 'default' }).where(eq(linkedAccounts.id, row.id));
    migrated++;
  }
  return migrated;
}
