import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import * as jose from 'jose';
import { config } from '../../server/config.js';
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
  deviceCodes,
  oidcSessions,
  tenants,
  pushedAuthRequests,
  dpopJtis,
} from '../../server/schema.js';

vi.mock('../../server/services/email.service.js', () => ({
  emailService: {
    sendVerificationEmail: vi.fn().mockResolvedValue(true),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
    sendAccountDeletionConfirmEmail: vi.fn().mockResolvedValue(true),
  },
}));

// Bypass rate limiting in integration tests — the limiter shares a single
// in-process cache across the entire test suite, so beforeEach logins quickly
// exhaust the 10/60s budget and every subsequent test gets HTTP 429.
vi.mock('../../server/middleware/rate-limit.js', () => ({
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
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
    await db.delete(deviceCodes).where(eq(deviceCodes.clientId, testClient.clientId));
    // oidc_sessions.user_id has an FK to users — must go before the users delete below.
    await db.delete(oidcSessions).where(
      inArray(oidcSessions.userId, db.select({ id: users.id }).from(users).where(eq(users.username, testUser.username)))
    );
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
      // client_secret is required here: the grant registry authenticates the
      // client before the handler validates its own params, so an absent
      // client_secret would otherwise fail as invalid_client (401) instead
      // of the invalid_request (400) this test is actually about.
      const response = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'refresh_token', client_id: testClient.clientId, client_secret: testClient.clientSecret });

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

  describe('POST /api/oidc/introspect', () => {
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

    it('rejects a client authentication failure', async () => {
      const response = await request(app)
        .post('/api/oidc/introspect')
        .send({ token: 'whatever', client_id: testClient.clientId, client_secret: 'wrong' });
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_client');
    });

    it('reports active:false for an unknown token', async () => {
      const response = await request(app)
        .post('/api/oidc/introspect')
        .send({ token: 'not-a-real-token', client_id: testClient.clientId, client_secret: testClient.clientSecret });
      expect(response.status).toBe(200);
      expect(response.body.active).toBe(false);
    });

    it('reports active:true with claims for a valid access token owned by the requesting client', async () => {
      const { access_token } = await getTokens();
      const response = await request(app)
        .post('/api/oidc/introspect')
        .send({ token: access_token, client_id: testClient.clientId, client_secret: testClient.clientSecret });

      expect(response.status).toBe(200);
      expect(response.body.active).toBe(true);
      expect(response.body.client_id).toBe(testClient.clientId);
      expect(response.body.sub).toBeTruthy();
    });

    it('reports active:false for a token owned by a different client', async () => {
      const { access_token } = await getTokens();
      const otherClient = {
        id: 'other-oidc-client-row',
        clientId: 'other-oidc-client',
        clientSecret: 'other-oidc-client-secret',
        clientName: 'Other OIDC Client',
        redirectUris: 'http://localhost:3000/other-callback',
        grantTypes: 'authorization_code',
      };
      await db.delete(clients).where(eq(clients.clientId, otherClient.clientId));
      await db.insert(clients).values(otherClient);

      const response = await request(app)
        .post('/api/oidc/introspect')
        .send({ token: access_token, client_id: otherClient.clientId, client_secret: otherClient.clientSecret });

      expect(response.status).toBe(200);
      expect(response.body.active).toBe(false);

      await db.delete(clients).where(eq(clients.clientId, otherClient.clientId));
    });

    it('reports active:false after the token has been revoked', async () => {
      const { access_token } = await getTokens();
      await request(app)
        .post('/api/oidc/revoke')
        .send({ token: access_token, client_id: testClient.clientId, client_secret: testClient.clientSecret });

      const response = await request(app)
        .post('/api/oidc/introspect')
        .send({ token: access_token, client_id: testClient.clientId, client_secret: testClient.clientSecret });

      expect(response.status).toBe(200);
      expect(response.body.active).toBe(false);
    });
  });

  describe('POST /api/oidc/revoke', () => {
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

    it('returns 200 for an unknown token (no existence leak)', async () => {
      const response = await request(app)
        .post('/api/oidc/revoke')
        .send({ token: 'not-a-real-token', client_id: testClient.clientId, client_secret: testClient.clientSecret });
      expect(response.status).toBe(200);
    });

    it('revokes an access token so it can no longer be used', async () => {
      const { access_token } = await getTokens();

      const revokeRes = await request(app)
        .post('/api/oidc/revoke')
        .send({ token: access_token, client_id: testClient.clientId, client_secret: testClient.clientSecret });
      expect(revokeRes.status).toBe(200);

      const userinfoRes = await request(app)
        .get('/api/oidc/userinfo')
        .set('Authorization', `Bearer ${access_token}`);
      expect(userinfoRes.status).toBe(401);
    });

    it('revokes a refresh token so it can no longer be exchanged', async () => {
      const { refresh_token } = await getTokens();

      const revokeRes = await request(app)
        .post('/api/oidc/revoke')
        .send({ token: refresh_token, client_id: testClient.clientId, client_secret: testClient.clientSecret });
      expect(revokeRes.status).toBe(200);

      const refreshRes = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
        });
      expect(refreshRes.status).toBe(400);
    });
  });

  describe('POST /api/oidc/token — client_credentials', () => {
    const m2mClient = {
      id: 'test-m2m-client-row',
      clientId: 'test-m2m-client',
      clientSecret: 'test-m2m-client-secret',
      clientName: 'Test M2M Client',
      redirectUris: 'http://localhost:3000/callback',
      grantTypes: 'client_credentials',
      allowedScopes: 'reports:read',
    };

    beforeEach(async () => {
      await db.delete(clients).where(eq(clients.clientId, m2mClient.clientId));
      await db.insert(clients).values(m2mClient);
    });

    it('rejects a client with no allowed_scopes configured', async () => {
      const response = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'client_credentials', client_id: testClient.clientId, client_secret: testClient.clientSecret });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_scope');
    });

    it('issues a scoped, refresh-less access token for an allowed client', async () => {
      const response = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'client_credentials', client_id: m2mClient.clientId, client_secret: m2mClient.clientSecret });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body.scope).toBe('reports:read');
      expect(response.body).not.toHaveProperty('refresh_token');
      expect(response.body).not.toHaveProperty('id_token');
    });

    it('rejects a scope outside the client\'s allowed_scopes', async () => {
      const response = await request(app)
        .post('/api/oidc/token')
        .send({
          grant_type: 'client_credentials',
          client_id: m2mClient.clientId,
          client_secret: m2mClient.clientSecret,
          scope: 'reports:write',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_scope');
    });

    it('rejects a machine token used against a user-facing route', async () => {
      const tokenRes = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'client_credentials', client_id: m2mClient.clientId, client_secret: m2mClient.clientSecret });

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokenRes.body.access_token}`);

      expect(meRes.status).toBe(401);
    });
  });

  describe('device authorization flow', () => {
    async function startDeviceFlow() {
      const res = await request(app)
        .post('/api/oidc/device_authorization')
        .send({ client_id: testClient.clientId, client_secret: testClient.clientSecret, scope: 'openid' });
      return res.body as { device_code: string; user_code: string; interval: number };
    }

    it('issues a device_code and user_code', async () => {
      const res = await request(app)
        .post('/api/oidc/device_authorization')
        .send({ client_id: testClient.clientId, client_secret: testClient.clientSecret });

      expect(res.status).toBe(200);
      expect(res.body.device_code).toBeTruthy();
      expect(res.body.user_code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
      expect(res.body.verification_uri_complete).toContain(res.body.user_code);
    });

    it('polling before approval returns authorization_pending', async () => {
      const { device_code } = await startDeviceFlow();

      const response = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code, client_id: testClient.clientId, client_secret: testClient.clientSecret });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('authorization_pending');
    });

    it('GET device/verify requires auth and rejects an unknown user_code', async () => {
      const anon = await request(app).get('/api/oidc/device/verify').query({ user_code: 'AAAA-AAAA' });
      expect(anon.status).toBe(401);

      const unknown = await request(app)
        .get('/api/oidc/device/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ user_code: 'ZZZZ-ZZZZ' });
      expect(unknown.status).toBe(404);
    });

    it('GET device/verify returns the requesting client name for a pending code', async () => {
      const { user_code } = await startDeviceFlow();

      const response = await request(app)
        .get('/api/oidc/device/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ user_code });

      expect(response.status).toBe(200);
      expect(response.body.data.client_name).toBe(testClient.clientName);
    });

    it('approving lets the device_code exchange succeed exactly once', async () => {
      const { device_code, user_code } = await startDeviceFlow();

      const approveRes = await request(app)
        .post('/api/oidc/device/approve')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ user_code });
      expect(approveRes.status).toBe(200);

      const tokenRes = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code, client_id: testClient.clientId, client_secret: testClient.clientSecret });
      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body).toHaveProperty('access_token');
      expect(tokenRes.body).toHaveProperty('id_token');

      const replayRes = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code, client_id: testClient.clientId, client_secret: testClient.clientSecret });
      expect(replayRes.status).toBe(400);
      expect(replayRes.body.error).toBe('invalid_grant');
    });

    it('denying makes the device_code exchange fail with access_denied', async () => {
      const { device_code, user_code } = await startDeviceFlow();

      const denyRes = await request(app)
        .post('/api/oidc/device/deny')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ user_code });
      expect(denyRes.status).toBe(200);

      const tokenRes = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code, client_id: testClient.clientId, client_secret: testClient.clientSecret });
      expect(tokenRes.status).toBe(400);
      expect(tokenRes.body.error).toBe('access_denied');
    });

    it('polling faster than the interval returns slow_down', async () => {
      const { device_code } = await startDeviceFlow();

      // First poll sets lastPolledAt; an immediate second poll is within the 5s interval.
      await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code, client_id: testClient.clientId, client_secret: testClient.clientSecret });

      const response = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code, client_id: testClient.clientId, client_secret: testClient.clientSecret });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('slow_down');
    });

    it('rejects an unknown device_code', async () => {
      const response = await request(app)
        .post('/api/oidc/token')
        .send({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: 'not-a-real-code', client_id: testClient.clientId, client_secret: testClient.clientSecret });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_grant');
    });
  });

  describe('OIDC sessions + RP-initiated logout', () => {
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

    it('id_token carries sid and auth_time, backed by an oidc_sessions row', async () => {
      const { id_token } = await getTokens();
      const payload = jwt.decode(id_token) as any;

      expect(payload.sid).toBeTruthy();
      expect(payload.auth_time).toBeTruthy();

      const [row] = await db.select().from(oidcSessions).where(eq(oidcSessions.sid, payload.sid)).limit(1);
      expect(row).toBeTruthy();
      expect(row.clientId).toBe(testClient.clientId);
      expect(row.terminatedAt).toBeNull();
    });

    it('re-authorizing the same login session reuses the same sid', async () => {
      const first = await getTokens();
      const firstSid = (jwt.decode(first.id_token) as any).sid;

      const second = await getTokens();
      const secondSid = (jwt.decode(second.id_token) as any).sid;

      expect(secondSid).toBe(firstSid);
    });

    it('GET end_session redirects to the hash-routed confirmation page', async () => {
      const { id_token } = await getTokens();
      const payload = jwt.decode(id_token) as any;

      const response = await request(app).get('/api/oidc/end_session').query({ id_token_hint: id_token });

      expect(response.status).toBe(302);
      const location = new URL(response.headers.location);
      expect(location.hash).toContain('/logout');
      expect(location.searchParams.get('sid')).toBe(payload.sid);
    });

    it('end_session ignores an unregistered post_logout_redirect_uri', async () => {
      const { id_token } = await getTokens();

      const response = await request(app)
        .get('/api/oidc/end_session')
        .query({ id_token_hint: id_token, post_logout_redirect_uri: 'http://evil.example/callback' });

      const location = new URL(response.headers.location);
      expect(location.searchParams.get('post_logout_redirect_uri')).toBeNull();
    });

    it('end_session/confirm terminates the session and revokes its tokens', async () => {
      const { access_token, id_token } = await getTokens();
      const sid = (jwt.decode(id_token) as any).sid;

      const confirmRes = await request(app)
        .post('/api/oidc/end_session/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});
      expect(confirmRes.status).toBe(200);

      const [row] = await db.select().from(oidcSessions).where(eq(oidcSessions.sid, sid)).limit(1);
      expect(row?.terminatedAt).toBeTruthy();

      const userinfoRes = await request(app)
        .get('/api/oidc/userinfo')
        .set('Authorization', `Bearer ${access_token}`);
      expect(userinfoRes.status).toBe(401);
    });
  });

  describe('client_secret_jwt authentication', () => {
    function buildAssertion(secret: string, overrides: Record<string, any> = {}) {
      return jwt.sign(
        {
          iss: testClient.clientId,
          sub: testClient.clientId,
          aud: `${config.APP_URL}/api/oidc/token`,
          jti: crypto.randomUUID(),
          ...overrides,
        },
        secret,
        { algorithm: 'HS256', expiresIn: '4m' }
      );
    }

    async function getAuthCode() {
      const res = await authorize();
      return extractCode(res.body.data.redirect_url);
    }

    it('authenticates the client via a client_secret_jwt assertion', async () => {
      const code = await getAuthCode();
      const assertion = buildAssertion(testClient.clientSecret);

      const response = await request(app).post('/api/oidc/token').send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: testClient.redirectUris,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
    });

    it('rejects a replayed client_assertion jti', async () => {
      const assertion = buildAssertion(testClient.clientSecret);
      const code1 = await getAuthCode();
      await request(app).post('/api/oidc/token').send({
        grant_type: 'authorization_code',
        code: code1,
        redirect_uri: testClient.redirectUris,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      });

      const code2 = await getAuthCode();
      const replay = await request(app).post('/api/oidc/token').send({
        grant_type: 'authorization_code',
        code: code2,
        redirect_uri: testClient.redirectUris,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      });

      expect(replay.status).toBe(401);
      expect(replay.body.error).toBe('invalid_client');
    });

    it('rejects an assertion signed with the wrong secret', async () => {
      const code = await getAuthCode();
      const assertion = buildAssertion('definitely-not-the-real-client-secret');

      const response = await request(app).post('/api/oidc/token').send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: testClient.redirectUris,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_client');
    });

    it('rejects an assertion whose sub does not match its iss', async () => {
      const code = await getAuthCode();
      const assertion = buildAssertion(testClient.clientSecret, { sub: 'someone-else' });

      const response = await request(app).post('/api/oidc/token').send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: testClient.redirectUris,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/oidc/token — token-exchange', () => {
    const exchangeClient = {
      id: 'test-exchange-client-row',
      clientId: 'test-exchange-client',
      clientSecret: 'test-exchange-client-secret',
      clientName: 'Test Exchange Client',
      redirectUris: 'http://localhost:3000/callback',
      grantTypes: 'urn:ietf:params:oauth:grant-type:token-exchange',
      allowedAudiences: 'downstream-api',
    };

    beforeEach(async () => {
      await db.delete(clients).where(eq(clients.clientId, exchangeClient.clientId));
      await db.insert(clients).values(exchangeClient);
    });

    async function getSubjectToken() {
      const res = await authorize();
      const code = extractCode(res.body.data.redirect_url);
      const tokenRes = await request(app).post('/api/oidc/token').send({
        grant_type: 'authorization_code',
        code,
        client_id: testClient.clientId,
        client_secret: testClient.clientSecret,
        redirect_uri: testClient.redirectUris,
      });
      return tokenRes.body.access_token;
    }

    it('exchanges a valid subject_token for an audience-bound token', async () => {
      const subjectToken = await getSubjectToken();

      const response = await request(app).post('/api/oidc/token').send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: 'downstream-api',
        client_id: exchangeClient.clientId,
        client_secret: exchangeClient.clientSecret,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:access_token');
    });

    it('rejects an audience outside allowed_audiences', async () => {
      const subjectToken = await getSubjectToken();

      const response = await request(app).post('/api/oidc/token').send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: 'not-allowed',
        client_id: exchangeClient.clientId,
        client_secret: exchangeClient.clientSecret,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_target');
    });

    it('rejects an unsupported subject_token_type', async () => {
      const response = await request(app).post('/api/oidc/token').send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'whatever',
        subject_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
        audience: 'downstream-api',
        client_id: exchangeClient.clientId,
        client_secret: exchangeClient.clientSecret,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });

    it('rejects an invalid subject_token', async () => {
      const response = await request(app).post('/api/oidc/token').send({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'not-a-real-token',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: 'downstream-api',
        client_id: exchangeClient.clientId,
        client_secret: exchangeClient.clientSecret,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_grant');
    });
  });

  describe('dynamic client registration (RFC 7591/7592)', () => {
    let originalSettings: string | null;
    let registeredClientId: string | undefined;

    beforeEach(async () => {
      const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, 'default')).limit(1);
      originalSettings = tenant?.settings ?? null;
      registeredClientId = undefined;
    });

    afterEach(async () => {
      await db.update(tenants).set({ settings: originalSettings ?? '{}' }).where(eq(tenants.id, 'default'));
      if (registeredClientId) {
        await db.delete(clients).where(eq(clients.clientId, registeredClientId));
      }
    });

    async function enableDynamicRegistration() {
      await db.update(tenants).set({ settings: JSON.stringify({ dynamicClientRegistration: true }) }).where(eq(tenants.id, 'default'));
    }

    it('rejects registration when the tenant has not enabled it', async () => {
      const response = await request(app).post('/api/oidc/register').send({
        redirect_uris: ['https://client.example.com/callback'],
      });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('access_denied');
    });

    it('registers a client and supports the RFC 7592 read/update/delete lifecycle', async () => {
      await enableDynamicRegistration();

      const registerRes = await request(app).post('/api/oidc/register').send({
        client_name: 'Dynamically Registered Client',
        redirect_uris: ['https://client.example.com/callback'],
        grant_types: ['authorization_code'],
      });

      expect(registerRes.status).toBe(201);
      expect(registerRes.body.client_id).toBeTruthy();
      expect(registerRes.body.client_secret).toBeTruthy();
      expect(registerRes.body.registration_access_token).toBeTruthy();
      registeredClientId = registerRes.body.client_id;

      const regToken = registerRes.body.registration_access_token;

      const wrongTokenRes = await request(app)
        .get(`/api/oidc/register/${registeredClientId}`)
        .set('Authorization', 'Bearer not-the-right-token');
      expect(wrongTokenRes.status).toBe(401);

      const readRes = await request(app)
        .get(`/api/oidc/register/${registeredClientId}`)
        .set('Authorization', `Bearer ${regToken}`);
      expect(readRes.status).toBe(200);
      expect(readRes.body.client_name).toBe('Dynamically Registered Client');

      const updateRes = await request(app)
        .put(`/api/oidc/register/${registeredClientId}`)
        .set('Authorization', `Bearer ${regToken}`)
        .send({ client_name: 'Renamed Client', redirect_uris: ['https://client.example.com/callback2'] });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.client_name).toBe('Renamed Client');
      expect(updateRes.body.redirect_uris).toEqual(['https://client.example.com/callback2']);

      const deleteRes = await request(app)
        .delete(`/api/oidc/register/${registeredClientId}`)
        .set('Authorization', `Bearer ${regToken}`);
      expect(deleteRes.status).toBe(204);
      registeredClientId = undefined; // already gone, afterEach doesn't need to clean it up

      const readAfterDeleteRes = await request(app)
        .get(`/api/oidc/register/${registerRes.body.client_id}`)
        .set('Authorization', `Bearer ${regToken}`);
      expect(readAfterDeleteRes.status).toBe(401);
    });

    it('rejects registration with a non-https redirect_uri', async () => {
      await enableDynamicRegistration();

      const response = await request(app).post('/api/oidc/register').send({
        redirect_uris: ['http://not-secure.example.com/callback'],
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_client_metadata');
    });
  });

  describe('pushed authorization requests (RFC 9126)', () => {
    afterEach(async () => {
      await db.delete(pushedAuthRequests).where(eq(pushedAuthRequests.clientId, testClient.clientId));
    });

    it('pushes an authorization request and redeems it via /authorize', async () => {
      const parRes = await request(app).post('/api/oidc/par').send({
        client_id: testClient.clientId,
        client_secret: testClient.clientSecret,
        response_type: 'code',
        redirect_uri: testClient.redirectUris,
        scope: 'openid profile',
      });

      expect(parRes.status).toBe(201);
      expect(parRes.body.request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:/);

      const getRes = await request(app).get('/api/oidc/authorize').query({
        client_id: testClient.clientId,
        request_uri: parRes.body.request_uri,
      });
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.client_name).toBe(testClient.clientName);

      const authRes = await request(app)
        .post('/api/oidc/authorize')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ client_id: testClient.clientId, request_uri: parRes.body.request_uri });

      expect(authRes.status).toBe(200);
      expect(authRes.body.data.redirect_url).toContain(testClient.redirectUris);
    });

    it('rejects reuse of an already-redeemed request_uri', async () => {
      const parRes = await request(app).post('/api/oidc/par').send({
        client_id: testClient.clientId,
        client_secret: testClient.clientSecret,
        response_type: 'code',
        redirect_uri: testClient.redirectUris,
      });

      await request(app)
        .post('/api/oidc/authorize')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ client_id: testClient.clientId, request_uri: parRes.body.request_uri });

      const secondRes = await request(app)
        .post('/api/oidc/authorize')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ client_id: testClient.clientId, request_uri: parRes.body.request_uri });

      expect(secondRes.status).toBe(400);
    });

    it('rejects a request_uri pushed by a different client', async () => {
      const otherClient = {
        id: 'test-par-other-client-row',
        clientId: 'test-par-other-client',
        clientSecret: 'test-par-other-secret',
        clientName: 'PAR Other Client',
        redirectUris: 'http://localhost:3000/other-callback',
        grantTypes: 'authorization_code',
      };
      await db.delete(clients).where(eq(clients.clientId, otherClient.clientId));
      await db.insert(clients).values(otherClient);

      const parRes = await request(app).post('/api/oidc/par').send({
        client_id: otherClient.clientId,
        client_secret: otherClient.clientSecret,
        response_type: 'code',
        redirect_uri: otherClient.redirectUris,
      });

      const authRes = await request(app)
        .post('/api/oidc/authorize')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ client_id: testClient.clientId, request_uri: parRes.body.request_uri });

      expect(authRes.status).toBe(400);
      await db.delete(clients).where(eq(clients.clientId, otherClient.clientId));
    });
  });

  describe('DPoP-bound tokens (RFC 9449)', () => {
    afterEach(async () => {
      await db.delete(dpopJtis);
    });

    async function makeDpopProof(keyPair: jose.GenerateKeyPairResult, htm: string, htu: string, extra: Record<string, unknown> = {}) {
      const publicJwk = await jose.exportJWK(keyPair.publicKey);
      return new jose.SignJWT({ htm, htu, ...extra })
        .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk })
        .setIssuedAt()
        .setJti(crypto.randomUUID())
        .sign(keyPair.privateKey);
    }

    it('issues a DPoP-bound token when a DPoP proof accompanies the token request, and enforces it on resource access', async () => {
      const keyPair = await jose.generateKeyPair('ES256', { extractable: true });
      const tokenUrl = `${config.APP_URL}/api/oidc/token`;

      const authRes = await authorize();
      const code = extractCode(authRes.body.data.redirect_url);

      const proof = await makeDpopProof(keyPair, 'POST', tokenUrl);
      const tokenRes = await request(app)
        .post('/api/oidc/token')
        .set('DPoP', proof)
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
          redirect_uri: testClient.redirectUris,
        });

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.token_type).toBe('DPoP');
      const boundToken = tokenRes.body.access_token;

      // Plain Bearer usage of a DPoP-bound token must be rejected.
      const bearerRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${boundToken}`);
      expect(bearerRes.status).toBe(401);

      // Correct DPoP proof (with ath bound to this token) succeeds.
      const resourceProof = await makeDpopProof(keyPair, 'GET', `${config.APP_URL}/api/auth/me`, {
        ath: crypto.createHash('sha256').update(boundToken).digest('base64url'),
      });
      const dpopRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `DPoP ${boundToken}`)
        .set('DPoP', resourceProof);
      expect(dpopRes.status).toBe(200);

      // A proof signed by a different key must be rejected even with a correct ath.
      const otherKeyPair = await jose.generateKeyPair('ES256', { extractable: true });
      const wrongKeyProof = await makeDpopProof(otherKeyPair, 'GET', `${config.APP_URL}/api/auth/me`, {
        ath: crypto.createHash('sha256').update(boundToken).digest('base64url'),
      });
      const wrongKeyRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `DPoP ${boundToken}`)
        .set('DPoP', wrongKeyProof);
      expect(wrongKeyRes.status).toBe(401);
    });

    it('rejects a DPoP proof at the token endpoint whose htu does not match', async () => {
      const keyPair = await jose.generateKeyPair('ES256', { extractable: true });
      const authRes = await authorize();
      const code = extractCode(authRes.body.data.redirect_url);

      const proof = await makeDpopProof(keyPair, 'POST', `${config.APP_URL}/api/oidc/wrong-endpoint`);
      const tokenRes = await request(app)
        .post('/api/oidc/token')
        .set('DPoP', proof)
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: testClient.clientId,
          client_secret: testClient.clientSecret,
          redirect_uri: testClient.redirectUris,
        });

      expect(tokenRes.status).toBe(400);
      expect(tokenRes.body.error).toBe('invalid_dpop_proof');
    });
  });
});
