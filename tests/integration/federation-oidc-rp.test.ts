import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const { authorizationCodeGrant } = vi.hoisted(() => ({ authorizationCodeGrant: vi.fn() }));

vi.mock('openid-client', () => ({
  discovery: vi.fn().mockResolvedValue({}),
  ClientSecretPost: vi.fn(),
  randomPKCECodeVerifier: vi.fn().mockReturnValue('verifier'),
  calculatePKCECodeChallenge: vi.fn().mockResolvedValue('challenge'),
  randomState: vi.fn().mockReturnValue('state'),
  randomNonce: vi.fn().mockReturnValue('nonce'),
  buildAuthorizationUrl: vi.fn().mockReturnValue(new URL('https://idp.example.com/authorize')),
  authorizationCodeGrant,
}));

import { db, initDatabase } from '../../server/database.js';
import { eq, inArray } from 'drizzle-orm';
import { users, identityProviders, oauthStates, linkedAccounts, refreshTokens, sessions, accessTokens, authCodes } from '../../server/schema.js';
import { encryptToken } from '../../server/services/crypto.js';
import { app } from '../../server.js';
import request from 'supertest';
import crypto from 'crypto';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;
const ALIAS = 'test-oidc-idp';
const RUN_SUFFIX = crypto.randomUUID().slice(0, 8);
const TEST_EMAIL = `oidc-user-${RUN_SUFFIX}@example.com`;
const TEST_USERNAME = `oidcuser_${RUN_SUFFIX}`;

describe.skipIf(skipIfNoDb)('OIDC-RP federation callback', () => {
  beforeAll(async () => {
    await initDatabase();

    await db.insert(identityProviders).values({
      id: crypto.randomUUID(),
      tenantId: 'default',
      alias: ALIAS,
      type: 'oidc',
      displayName: 'Test OIDC IdP',
      enabled: true,
      configEnc: encryptToken(JSON.stringify({
        issuer: 'https://idp.example.com',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      })),
      jitProvisioning: true,
    }).onConflictDoNothing();
  });

  beforeEach(async () => {
    authorizationCodeGrant.mockReset();

    const staleUsers = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_EMAIL));
    if (staleUsers.length > 0) {
      const ids = staleUsers.map((u) => u.id);
      await db.delete(authCodes).where(inArray(authCodes.userId, ids));
      await db.delete(refreshTokens).where(inArray(refreshTokens.userId, ids));
      await db.delete(accessTokens).where(inArray(accessTokens.userId, ids));
      await db.delete(sessions).where(inArray(sessions.userId, ids));
      await db.delete(linkedAccounts).where(inArray(linkedAccounts.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  });

  async function seedState(overrides: Partial<{ alias: string; tenantId: string; redirectAfter: string }> = {}) {
    const state = crypto.randomBytes(16).toString('hex');
    await db.insert(oauthStates).values({
      state,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      provider: `oidc:${ALIAS}`,
      payload: JSON.stringify({
        tenantId: overrides.tenantId ?? 'default',
        alias: overrides.alias ?? ALIAS,
        codeVerifier: 'verifier',
        nonce: 'nonce',
        redirectAfter: overrides.redirectAfter ?? '/dashboard',
      }),
    });
    return state;
  }

  it('logs in via JIT provisioning and issues a federation exchange code', async () => {
    const state = await seedState();
    authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({ sub: 'oidc-user-1', email: TEST_EMAIL, email_verified: true, preferred_username: TEST_USERNAME, name: 'OIDC User' }),
    });

    const res = await request(app).get(`/api/federation/${ALIAS}/oidc/callback`).query({ state, code: 'irrelevant' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('federation_code=');
    expect(res.headers.location).toContain('#/dashboard');
  });

  it('rejects a reused state parameter (single-use guard)', async () => {
    const state = await seedState();
    authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'oidc-user-1', email: TEST_EMAIL, email_verified: true, preferred_username: TEST_USERNAME, name: 'OIDC User' }),
    });

    const first = await request(app).get(`/api/federation/${ALIAS}/oidc/callback`).query({ state, code: 'irrelevant' });
    expect(first.status).toBe(302);
    expect(first.headers.location).toContain('federation_code=');

    const second = await request(app).get(`/api/federation/${ALIAS}/oidc/callback`).query({ state, code: 'irrelevant' });
    expect(second.status).toBe(302);
    expect(second.headers.location).toContain('/login');
  });

  it('rejects a state whose stored alias does not match the callback URL alias', async () => {
    const state = await seedState({ alias: 'some-other-alias' });

    const res = await request(app).get(`/api/federation/${ALIAS}/oidc/callback`).query({ state, code: 'irrelevant' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
    expect(authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it('collapses a protocol-relative redirect (//evil.com) to "/" to prevent an open redirect', async () => {
    const state = await seedState({ redirectAfter: '//evil.com' });
    authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({ sub: 'oidc-user-1', email: TEST_EMAIL, email_verified: true, preferred_username: TEST_USERNAME, name: 'OIDC User' }),
    });

    const res = await request(app).get(`/api/federation/${ALIAS}/oidc/callback`).query({ state, code: 'irrelevant' });
    expect(res.status).toBe(302);
    expect(res.headers.location).not.toContain('evil.com');
    expect(res.headers.location).toContain('/?federation_code=');
  });
});
