import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { db, initDatabase } from '../../server/database.js';
import { setFlagForTests, resetFeatureSnapshotForTests } from '../../server/services/feature.service.js';
import { app } from '../../server.js';
import request from 'supertest';

const skipIfNoDb = !process.env.DATABASE_URL && !process.env.PG_HOST;

// Verifies the "gate, don't delete" posture for token-exchange/PAR/DPoP/JWT auth: off by
// default so a self-hosted deployment doesn't advertise protocol surface it
// isn't using, but fully restorable by flipping the flag back on.
describe.skipIf(skipIfNoDb)('GET /.well-known/openid-configuration — feature-gated protocol surface', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterEach(() => {
    resetFeatureSnapshotForTests();
  });

  it('omits token-exchange, PAR, DPoP, and JWT auth methods from discovery by default', async () => {
    resetFeatureSnapshotForTests();
    const res = await request(app).get('/.well-known/openid-configuration');

    expect(res.status).toBe(200);
    expect(res.body.grant_types_supported).not.toContain('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(res.body).not.toHaveProperty('pushed_authorization_request_endpoint');
    expect(res.body).not.toHaveProperty('dpop_signing_alg_values_supported');
    expect(res.body.token_endpoint_auth_methods_supported).not.toContain('client_secret_jwt');
    expect(res.body.token_endpoint_auth_methods_supported).not.toContain('private_key_jwt');
  });

  it('advertises token-exchange, PAR, DPoP, and JWT auth methods once their flags are enabled', async () => {
    setFlagForTests('tokenExchange', true);
    setFlagForTests('par', true);
    setFlagForTests('dpop', true);
    setFlagForTests('clientSecretJwt', true);
    setFlagForTests('privateKeyJwt', true);

    const res = await request(app).get('/.well-known/openid-configuration');

    expect(res.status).toBe(200);
    expect(res.body.grant_types_supported).toContain('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(res.body.pushed_authorization_request_endpoint).toContain('/api/oidc/par');
    expect(res.body.dpop_signing_alg_values_supported).toEqual(['RS256', 'ES256']);
    expect(res.body.token_endpoint_auth_methods_supported).toContain('client_secret_jwt');
    expect(res.body.token_endpoint_auth_methods_supported).toContain('private_key_jwt');
  });

  it('returns the PAR endpoint as disabled (404) while the flag is off', async () => {
    const res = await request(app).post('/api/oidc/par').send({});
    expect(res.status).toBe(404);
  });
});
