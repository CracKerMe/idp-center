import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../database.js';
import { config } from '../config.js';
import { clients, tenants } from '../schema.js';
import { parseList } from './client-auth.js';

const VALID_AUTH_METHODS = new Set(['client_secret_post', 'client_secret_basic', 'client_secret_jwt', 'private_key_jwt', 'none']);

function regError(res: Response, status: number, error: string, description?: string) {
  const body: Record<string, string> = { error };
  if (description) body.error_description = description;
  return res.status(status).json(body);
}

function hashRegToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function isDynamicRegistrationEnabled(tenantId: string): Promise<boolean> {
  const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return false;
  try {
    const settings = JSON.parse(tenant.settings || '{}');
    return settings.dynamicClientRegistration === true;
  } catch {
    return false;
  }
}

function toArrayField(raw: string | null): string[] {
  return parseList(raw);
}

function clientMetadata(row: typeof clients.$inferSelect) {
  return {
    client_id: row.clientId,
    client_id_issued_at: row.createdAt ? Math.floor(new Date(row.createdAt).getTime() / 1000) : undefined,
    client_name: row.clientName,
    redirect_uris: toArrayField(row.redirectUris),
    grant_types: toArrayField(row.grantTypes),
    token_endpoint_auth_method: row.tokenEndpointAuthMethod || 'client_secret_post',
    scope: row.allowedScopes || undefined,
    jwks: row.jwks ? JSON.parse(row.jwks) : undefined,
    jwks_uri: row.jwksUri || undefined,
    frontchannel_logout_uri: row.frontchannelLogoutUri || undefined,
    backchannel_logout_uri: row.backchannelLogoutUri || undefined,
    post_logout_redirect_uris: row.postLogoutRedirectUris ? toArrayField(row.postLogoutRedirectUris) : undefined,
    registration_client_uri: `${config.APP_URL}/api/oidc/register/${row.clientId}`,
  };
}

/**
 * RFC 7591 client registration metadata validation. Kept intentionally strict:
 * a public-registration endpoint that accepts unvalidated redirect_uris is an
 * open redirect / token-theft vector.
 */
function validateRegistrationRequest(body: Record<string, any>): { error: string } | { redirectUris: string[]; grantTypes: string[]; authMethod: string } {
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u: unknown) => typeof u === 'string') : [];
  if (redirectUris.length === 0) return { error: 'redirect_uris is required and must be a non-empty array' };
  for (const uri of redirectUris) {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return { error: `redirect_uri must use https: ${uri}` };
      }
    } catch {
      return { error: `Invalid redirect_uri: ${uri}` };
    }
  }

  const grantTypes = Array.isArray(body.grant_types) && body.grant_types.length > 0 ? body.grant_types : ['authorization_code'];
  if (!grantTypes.every((g: unknown) => typeof g === 'string')) return { error: 'grant_types must be an array of strings' };

  const authMethod = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'client_secret_post';
  if (!VALID_AUTH_METHODS.has(authMethod)) return { error: `Unsupported token_endpoint_auth_method: ${authMethod}` };

  return { redirectUris, grantTypes, authMethod };
}

// POST /api/oidc/register — RFC 7591. Gated per-tenant via tenants.settings.dynamicClientRegistration;
// open dynamic registration on a multi-tenant IdP is an unauthenticated client-spam vector.
export async function handleRegister(req: Request, res: Response) {
  const tenantId = req.tenantId!;
  if (!(await isDynamicRegistrationEnabled(tenantId))) {
    return regError(res, 403, 'access_denied', 'Dynamic client registration is not enabled for this tenant');
  }

  const validated = validateRegistrationRequest(req.body || {});
  if ('error' in validated) return regError(res, 400, 'invalid_client_metadata', validated.error);
  const { redirectUris, grantTypes, authMethod } = validated;

  const clientId = crypto.randomBytes(16).toString('hex');
  const issueSecret = authMethod !== 'none';
  const clientSecret = issueSecret ? crypto.randomBytes(32).toString('hex') : '';
  // Hashed up front so the secret never has a plaintext-only window before first token request
  // (client_secret column stays populated only because it's NOT NULL; verifyClientSecret always
  // prefers the hash — see client-auth.ts).
  const clientSecretHash = issueSecret ? await bcrypt.hash(clientSecret, 10) : null;
  const registrationAccessToken = crypto.randomBytes(32).toString('hex');

  const clientName = typeof req.body?.client_name === 'string' && req.body.client_name.trim() ? req.body.client_name.trim() : clientId;
  const jwks = req.body?.jwks && typeof req.body.jwks === 'object' ? JSON.stringify(req.body.jwks) : null;
  const jwksUri = typeof req.body?.jwks_uri === 'string' ? req.body.jwks_uri : null;
  const scope = typeof req.body?.scope === 'string' ? req.body.scope : null;

  const [row] = await db.insert(clients).values({
    id: crypto.randomUUID(),
    clientId,
    clientSecret,
    clientSecretHash: clientSecretHash ?? undefined,
    clientSecretAlg: clientSecretHash ? 'bcrypt' : undefined,
    clientName,
    redirectUris: JSON.stringify(redirectUris),
    grantTypes: JSON.stringify(grantTypes),
    tenantId,
    tokenEndpointAuthMethod: authMethod,
    allowedScopes: scope,
    jwks,
    jwksUri,
    registrationTokenHash: hashRegToken(registrationAccessToken),
  }).returning();

  return res.status(201).json({
    ...clientMetadata(row),
    client_secret: issueSecret ? clientSecret : undefined,
    client_secret_expires_at: issueSecret ? 0 : undefined, // 0 = never expires (RFC 7591 §3.2.1)
    registration_access_token: registrationAccessToken,
  });
}

async function authenticateRegistrationRequest(req: Request, clientId: string): Promise<typeof clients.$inferSelect | null> {
  const authHeader = req.headers['authorization'];
  const match = authHeader ? /^Bearer\s+(.+)$/i.exec(authHeader) : null;
  if (!match) return null;

  const [row] = await db.select().from(clients).where(and(eq(clients.clientId, clientId), eq(clients.tenantId, req.tenantId!))).limit(1);
  if (!row || !row.registrationTokenHash) return null;

  const presented = hashRegToken(match[1]);
  const bufA = Buffer.from(presented);
  const bufB = Buffer.from(row.registrationTokenHash);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null;
  return row;
}

// GET /api/oidc/register/:client_id — RFC 7592 read.
export async function handleRegistrationRead(req: Request, res: Response) {
  const row = await authenticateRegistrationRequest(req, req.params.client_id);
  if (!row) return regError(res, 401, 'invalid_token', 'Invalid or missing registration access token');
  return res.json(clientMetadata(row));
}

// PUT /api/oidc/register/:client_id — RFC 7592 update.
export async function handleRegistrationUpdate(req: Request, res: Response) {
  const row = await authenticateRegistrationRequest(req, req.params.client_id);
  if (!row) return regError(res, 401, 'invalid_token', 'Invalid or missing registration access token');

  const validated = validateRegistrationRequest(req.body || {});
  if ('error' in validated) return regError(res, 400, 'invalid_client_metadata', validated.error);
  const { redirectUris, grantTypes, authMethod } = validated;

  const clientName = typeof req.body?.client_name === 'string' && req.body.client_name.trim() ? req.body.client_name.trim() : row.clientName;
  const jwks = req.body?.jwks && typeof req.body.jwks === 'object' ? JSON.stringify(req.body.jwks) : null;
  const jwksUri = typeof req.body?.jwks_uri === 'string' ? req.body.jwks_uri : null;
  const scope = typeof req.body?.scope === 'string' ? req.body.scope : null;

  const [updated] = await db.update(clients).set({
    clientName,
    redirectUris: JSON.stringify(redirectUris),
    grantTypes: JSON.stringify(grantTypes),
    tokenEndpointAuthMethod: authMethod,
    allowedScopes: scope,
    jwks,
    jwksUri,
  }).where(eq(clients.id, row.id)).returning();

  return res.json(clientMetadata(updated));
}

// DELETE /api/oidc/register/:client_id — RFC 7592 delete.
export async function handleRegistrationDelete(req: Request, res: Response) {
  const row = await authenticateRegistrationRequest(req, req.params.client_id);
  if (!row) return regError(res, 401, 'invalid_token', 'Invalid or missing registration access token');

  await db.delete(clients).where(eq(clients.id, row.id));
  return res.status(204).send();
}
