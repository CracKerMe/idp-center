import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import crypto from 'crypto';
import { db, initDatabase } from '../../server/database.js';
import { eq, inArray } from 'drizzle-orm';
import {
  users,
  clients,
  authCodes,
  accessTokens,
  refreshTokens,
  oauthStates,
  emailVerifications,
  sessions,
  passwordResets,
  trustedDevices,
  linkedAccounts,
  accountDeletionRequests,
  passwordHistory,
} from '../../server/schema.js';

vi.mock('../../server/services/email.service.js', () => ({
  emailService: {
    sendVerificationEmail: vi.fn().mockResolvedValue(true),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
    sendAccountDeletionConfirmEmail: vi.fn().mockResolvedValue(true),
  },
}));

import { app } from '../../server.js';
import request from 'supertest';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

// Characterization tests for the current authorization_code + refresh_token
// OAuth surface (server/routes/oidc.ts), written ahead of the Phase 1
// grant-registry rewrite (ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md §1.2) so
// the refactor has a behavioral safety net.
describe.skipIf(skipIfNoDb)('OIDC API Integration', () => {
  const testUser = {
    username: 'oidcuser',
    email: 'oidcuser@example.com',
    password: 'Password123!',
  };

  const testClient = {
    id: 'test-oidc-client-row',
    clientId: 'test-oidc-client',
    clientSecret: 'test-oidc-client-secret',
    clientName: 'Test OIDC Client',
    redirectUris: 'http://localhost:3000/callback',
    grantTypes: 'authorization_code',
  };

  let accessToken: string; // login access token, used to drive POST /authorize

  beforeAll(async () => {
    await initDatabase(); // push schema + seed defaults
  });

  beforeEach(async () => {
    // Clean test data in reverse dependency order
    await db.delete(passwordHistory).where(
      inArray(passwordHistory.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
    await db.delete(accountDeletionRequests).where(
      inArray(accountDeletionRequests.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
    await db.delete(linkedAccounts).where(
      inArray(linkedAccounts.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
    await db.delete(trustedDevices).where(
      inArray(trustedDevices.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
    // Scoped to this file's own user: access_tokens is a shared table and other
    // integration test files run concurrently against the same database.
    await db.delete(accessTokens).where(
      inArray(accessTokens.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
    await db.delete(passwordResets).where(
      inArray(passwordResets.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
    await db.delete(sessions).where(
      inArray(sessions.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
    await db.delete(refreshTokens).where(
      inArray(refreshTokens.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
    await db.delete(authCodes);
    await db.delete(oauthStates);
    await db.delete(clients).where(eq(clients.clientId, testClient.clientId));
    await db.delete(emailVerifications).where(
      inArray(emailVerifications.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
    await db.delete(users).where(eq(users.username, testUser.username));

    await db.insert(clients).values(testClient);

    await request(app).post('/api/auth/register').send(testUser);
    await db.update(users).set({ emailVerified: true }).where(eq(users.username, testUser.username));
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: testUser.username, password: testUser.password });
    accessToken = loginRes.body.data.access_token;
  });

  async function authorize(overrides: Record<string, any> = {}) {
    return request(app)
      .post('/api/oidc/authorize')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        client_id: testClient.clientId,
        redirect_uri: testClient.redirectUris,
        response_type: 'code',
        scope: 'openid profile email',
        ...overrides,
      });
  }

  function extractCode(redirectUrl: string): string {
    return new URL(redirectUrl).searchParams.get('code')!;
  }

  describe('GET /api/oidc/authorize', () => {
    it('returns client name and scope for a valid client/redirect_uri', async () => {
      const response = await request(app)
        .get('/api/oidc/authorize')
        .query({ client_id: testClient.clientId, redirect_uri: testClient.redirectUris, scope: 'openid' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('client_name', testClient.clientName);
    });

    it('rejects an unknown client_id', async () => {
      const response = await request(app)
        .get('/api/oidc/authorize')
        .query({ client_id: 'does-not-exist', redirect_uri: testClient.redirectUris });

      expect(response.status).toBe(400);
    });

    it('rejects a redirect_uri not registered for the client', async () => {
      const response = await request(app)
        .get('/api/oidc/authorize')
        .query({ client_id: testClient.clientId, redirect_uri: 'http://evil.example/callback' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/oidc/authorize', () => {
    it('requires authentication', async () => {
      const response = await request(app)
        .post('/api/oidc/authorize')
        .send({
          client_id: testClient.clientId,
          redirect_uri: testClient.redirectUris,
          response_type: 'code',
        });

      expect(response.status).toBe(401);
    });

    it('issues an authorization code as a redirect_url for a logged-in user', async () => {
      const response = await authorize();

      expect(response.status).toBe(200);
      expect(response.body.data.redirect_url).toContain(testClient.redirectUris);
      const url = new URL(response.body.data.redirect_url);
      expect(url.searchParams.get('code')).toBeTruthy();
      expect(url.searchParams.get('state')).toBeTruthy();

      const [row] = await db.select().from(authCodes).where(eq(authCodes.code, url.searchParams.get('code')!)).limit(1);
      expect(row).toBeTruthy();
      expect(row.clientId).toBe(testClient.clientId);
      expect(row.used).toBe(false);
    });

    it('rejects an unsupported response_type', async () => {
      const response = await authorize({ response_type: 'token' });
      expect(response.status).toBe(400);
    });

    it('rejects an unregistered redirect_uri', async () => {
      const response = await authorize({ redirect_uri: 'http://evil.example/callback' });
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/oidc/token — authorization_code', () => {
    async function getAuthCode() {
      const res = await authorize();
      return extractCode(res.body.data.redirect_url);
    }

    it('exchanges a valid code for tokens', async () => {
      const code = await getAuthCode();

      const response = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
          redirect_uri: testClient.redirectUris,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body).toHaveProperty('id_token');
      expect(response.body.token_type).toBe('Bearer');
      expect(response.body.user.username).toBe(testUser.username);
    });

    it('rejects reuse of an already-consumed code', async () => {
      const code = await getAuthCode();
      const params = {
        grant_type: 'authorization_code',
        code,
        client_id: testClient.clientId,
        client_secret: testClient.clientSecret,
        redirect_uri: testClient.redirectUris,
      };

      const first = await request(app).post('/api/oidc/token').send(params);
      expect(first.status).toBe(200);

      const second = await request(app).post('/api/oidc/token').send(params);
      expect(second.status).toBe(400);
    });

    it('rejects an invalid client_secret', async () => {
      const code = await getAuthCode();

      const response = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: testClient.clientId,
          client_secret: 'wrong-secret',
          redirect_uri: testClient.redirectUris,
        });

      expect(response.status).toBe(401);
    });

    it('rejects an unsupported grant_type', async () => {
      const response = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'client_credentials',
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
        });

      expect(response.status).toBe(400);
    });

    it('rejects a token exchange missing code_verifier when a code_challenge was registered', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

      const res = await authorize({ code_challenge: challenge, code_challenge_method: 'S256' });
      const code = extractCode(res.body.data.redirect_url);

      const withoutVerifier = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
          redirect_uri: testClient.redirectUris,
        });
      expect(withoutVerifier.status).toBe(400);
    });

    it('accepts a token exchange with the correct code_verifier', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

      const res = await authorize({ code_challenge: challenge, code_challenge_method: 'S256' });
      const code = extractCode(res.body.data.redirect_url);

      const response = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
          redirect_uri: testClient.redirectUris,
          code_verifier: verifier,
        });
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
    });

    it('rejects a token exchange with a wrong code_verifier', async () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

      const res = await authorize({ code_challenge: challenge, code_challenge_method: 'S256' });
      const code = extractCode(res.body.data.redirect_url);

      const response = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
          redirect_uri: testClient.redirectUris,
          code_verifier: 'wrong-verifier',
        });
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/oidc/token — refresh_token', () => {
    async function getTokens() {
      const res = await authorize();
      const code = extractCode(res.body.data.redirect_url);
      const tokenRes = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
          redirect_uri: testClient.redirectUris,
        });
      return tokenRes.body;
    }

    it('rotates the refresh token and issues a new access token', async () => {
      const { refresh_token: oldRefreshToken } = await getTokens();

      const response = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token: oldRefreshToken,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body.refresh_token).not.toBe(oldRefreshToken);
    });

    it('rejects a reused (already-rotated) refresh token', async () => {
      const { refresh_token: oldRefreshToken } = await getTokens();

      await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token: oldRefreshToken,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
        });

      const replay = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token: oldRefreshToken,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
        });

      expect(replay.status).toBe(400);
    });

    it('rejects a missing refresh_token', async () => {
      const response = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'refresh_token', client_id: testClient.clientId });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/oidc/userinfo', () => {
    async function getAccessToken(scope = 'openid profile email') {
      const res = await authorize({ scope });
      const code = extractCode(res.body.data.redirect_url);
      const tokenRes = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
          redirect_uri: testClient.redirectUris,
        });
      return tokenRes.body.access_token;
    }

    it('rejects a missing token', async () => {
      const response = await request(app).get('/api/oidc/userinfo');
      expect(response.status).toBe(401);
    });

    it('rejects an unknown token', async () => {
      const response = await request(app)
        .get('/api/oidc/userinfo')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(response.status).toBe(401);
    });

    it('returns claims scoped to the granted scope', async () => {
      const oidcAccessToken = await getAccessToken('openid profile email');

      const response = await request(app)
        .get('/api/oidc/userinfo')
        .set('Authorization', `Bearer ${oidcAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.sub).toBeTruthy();
      expect(response.body.email).toBe(testUser.email);
      expect(response.body.preferred_username).toBe(testUser.username);
    });

    it('omits profile/email claims when scope excludes them', async () => {
      const oidcAccessToken = await getAccessToken('openid');

      const response = await request(app)
        .get('/api/oidc/userinfo')
        .set('Authorization', `Bearer ${oidcAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.sub).toBeTruthy();
      expect(response.body.email).toBeUndefined();
      expect(response.body.preferred_username).toBeUndefined();
    });
  });
});
