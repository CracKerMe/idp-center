import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const validatePostResponseAsync = vi.fn();

vi.mock('@node-saml/node-saml', () => ({
  SAML: vi.fn().mockImplementation(function (this: any) {
    this.validatePostResponseAsync = validatePostResponseAsync;
    this.getAuthorizeUrlAsync = vi.fn().mockResolvedValue('https://idp.example.com/sso');
    this.generateServiceProviderMetadata = vi.fn().mockReturnValue('<EntityDescriptor/>');
  }),
}));

import { db, initDatabase } from '../../server/database.js';
import { eq, inArray } from 'drizzle-orm';
import { users, identityProviders, oauthStates, samlAssertionIds, linkedAccounts, refreshTokens, sessions, accessTokens, authCodes } from '../../server/schema.js';
import { encryptToken } from '../../server/services/crypto.js';
import { app } from '../../server.js';
import request from 'supertest';
import crypto from 'crypto';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;
const ALIAS = 'test-saml-idp';

describe.skipIf(skipIfNoDb)('SAML federation ACS', () => {
  beforeAll(async () => {
    await initDatabase();

    await db.insert(identityProviders).values({
      id: crypto.randomUUID(),
      tenantId: 'default',
      alias: ALIAS,
      type: 'saml',
      displayName: 'Test SAML IdP',
      enabled: true,
      configEnc: encryptToken(JSON.stringify({
        entryPoint: 'https://idp.example.com/sso',
        idpCert: 'FAKE_CERT',
      })),
      jitProvisioning: true,
    }).onConflictDoNothing();
  });

  beforeEach(async () => {
    validatePostResponseAsync.mockReset();
    await db.delete(samlAssertionIds).where(eq(samlAssertionIds.idpAlias, ALIAS));

    const staleUsers = await db.select({ id: users.id }).from(users).where(eq(users.email, 'saml-user@example.com'));
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

  async function seedState(redirectAfter = '/dashboard') {
    const relayState = crypto.randomBytes(16).toString('hex');
    await db.insert(oauthStates).values({
      state: relayState,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      provider: `saml:${ALIAS}`,
      payload: JSON.stringify({ tenantId: 'default', alias: ALIAS, redirectAfter }),
    });
    return relayState;
  }

  it('logs in a new user via JIT provisioning and issues a federation exchange code', async () => {
    const relayState = await seedState();
    validatePostResponseAsync.mockResolvedValueOnce({
      profile: { ID: `assertion-${crypto.randomUUID()}`, nameID: 'saml-user-1', email: 'saml-user@example.com', cn: 'SAML User' },
    });

    const res = await request(app)
      .post(`/api/federation/${ALIAS}/saml/acs`)
      .type('form')
      .send({ RelayState: relayState, SAMLResponse: 'irrelevant-because-mocked' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('federation_code=');
    expect(res.headers.location).toContain('#/dashboard');
  });

  it('rejects a replayed assertion ID on a second, otherwise-valid attempt', async () => {
    const assertionId = `assertion-${crypto.randomUUID()}`;
    const profile = { ID: assertionId, nameID: 'saml-user-1', email: 'saml-user@example.com', cn: 'SAML User' };

    const relayState1 = await seedState();
    validatePostResponseAsync.mockResolvedValueOnce({ profile });
    const first = await request(app)
      .post(`/api/federation/${ALIAS}/saml/acs`)
      .type('form')
      .send({ RelayState: relayState1, SAMLResponse: 'irrelevant' });
    expect(first.status).toBe(302);
    expect(first.headers.location).toContain('federation_code=');

    const relayState2 = await seedState();
    validatePostResponseAsync.mockResolvedValueOnce({ profile });
    const second = await request(app)
      .post(`/api/federation/${ALIAS}/saml/acs`)
      .type('form')
      .send({ RelayState: relayState2, SAMLResponse: 'irrelevant' });

    expect(second.status).toBe(302);
    expect(second.headers.location).toContain('/login');
    expect(second.headers.location.toLowerCase()).toContain('already');
  });

  it('collapses a protocol-relative redirect (//evil.com) to "/" to prevent an open redirect', async () => {
    const relayState = await seedState('//evil.com');
    validatePostResponseAsync.mockResolvedValueOnce({
      profile: { ID: `assertion-${crypto.randomUUID()}`, nameID: 'saml-user-1', email: 'saml-user@example.com', cn: 'SAML User' },
    });

    const res = await request(app)
      .post(`/api/federation/${ALIAS}/saml/acs`)
      .type('form')
      .send({ RelayState: relayState, SAMLResponse: 'irrelevant' });

    expect(res.status).toBe(302);
    expect(res.headers.location).not.toContain('evil.com');
    expect(res.headers.location).toContain('/#/?federation_code=');
  });

  it('rejects an ACS POST with no matching relay state', async () => {
    const res = await request(app)
      .post(`/api/federation/${ALIAS}/saml/acs`)
      .type('form')
      .send({ RelayState: 'nonexistent-state', SAMLResponse: 'irrelevant' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });
});
