import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as jose from 'jose';
import type { Request } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../database.js';
import { config } from '../config.js';
import { clients, clientAssertionJtis } from '../schema.js';
import { OAuthError } from './errors.js';
import { isEnabled } from '../services/feature.service.js';
import type { AuthenticatedClient, ClientAuthMethod } from './types.js';

const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const JWT_AUTH_METHODS = new Set<ClientAuthMethod>(['client_secret_jwt', 'private_key_jwt']);

/** Parses the "comma string OR JSON array" dual format used by clients.grant_types / redirect_uris. */
export function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against itself so a length mismatch doesn't produce a shorter-than-normal timing signal.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a presented client secret against the stored credential.
 *
 * Prefers the bcrypt hash when present. Rows that still only carry the legacy
 * plaintext secret are compared in constant time and then lazily upgraded to a
 * hash, so the plaintext column can be dropped in a later release
 * (ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md §1.2).
 */
export async function verifyClientSecret(row: typeof clients.$inferSelect, presented: string): Promise<boolean> {
  if (row.clientSecretHash) {
    return bcrypt.compare(presented, row.clientSecretHash);
  }

  const ok = timingSafeEqualStr(row.clientSecret, presented);
  if (ok) {
    // Lazy migration: hash on first successful auth. Failure here must never
    // break authentication, so it's best-effort.
    try {
      const hash = await bcrypt.hash(presented, 10);
      await db
        .update(clients)
        .set({ clientSecretHash: hash, clientSecretAlg: 'bcrypt' })
        .where(eq(clients.id, row.id));
    } catch (err) {
      console.warn(`[oauth] failed to lazily hash client_secret for ${row.clientId}:`, err);
    }
  }
  return ok;
}

function parseBasicAuth(header: string): { clientId: string; clientSecret: string } | null {
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return null;
  // RFC 6749 §2.3.1: both halves are form-urlencoded before being joined with ':'.
  // Malformed percent-escapes must yield a clean invalid_client, not a 500.
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, sep).replace(/\+/g, '%20')),
      clientSecret: decodeURIComponent(decoded.slice(sep + 1).replace(/\+/g, '%20')),
    };
  } catch {
    return null;
  }
}

/**
 * One-directional: a client registered for client_secret_jwt/private_key_jwt
 * must not be accepted via a plain secret — that would defeat the point of
 * registering the stronger method. The reverse (a plain-secret client
 * presenting a valid signed assertion instead) isn't a downgrade, so it's
 * allowed.
 */
function enforceAuthMethodCategory(configured: string | null, used: ClientAuthMethod): void {
  const configuredIsJwt = configured ? JWT_AUTH_METHODS.has(configured as ClientAuthMethod) : false;
  if (configuredIsJwt && !JWT_AUTH_METHODS.has(used)) {
    throw new OAuthError('invalid_client', 401, 'This client is registered for JWT-based authentication only');
  }
}

async function authenticateViaClientAssertion(req: Request, tenantId: string): Promise<AuthenticatedClient> {
  const assertion = req.body?.client_assertion;
  if (typeof assertion !== 'string') {
    throw new OAuthError('invalid_request', 400, 'client_assertion is required');
  }

  // Gated: client_secret_jwt and private_key_jwt must be enabled
  if (!isEnabled('clientSecretJwt') && !isEnabled('privateKeyJwt')) {
    throw new OAuthError('invalid_client', 401, 'Client JWT authentication is not enabled');
  }

  let header: jose.ProtectedHeaderParameters;
  let unverified: jose.JWTPayload;
  try {
    header = jose.decodeProtectedHeader(assertion);
    unverified = jose.decodeJwt(assertion);
  } catch {
    throw new OAuthError('invalid_client', 401, 'Malformed client_assertion');
  }

  const clientId = typeof unverified.sub === 'string' ? unverified.sub : undefined;
  if (!clientId || unverified.iss !== clientId) {
    throw new OAuthError('invalid_client', 401, 'client_assertion iss and sub must both equal the client_id');
  }

  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new OAuthError('invalid_client', 401, 'Unknown client');

  let authMethod: ClientAuthMethod;
  let verifyKey: Uint8Array | ReturnType<typeof jose.createLocalJWKSet> | ReturnType<typeof jose.createRemoteJWKSet>;

  if (header.alg === 'HS256') {
    if (!isEnabled('clientSecretJwt')) {
      throw new OAuthError('invalid_client', 401, 'client_secret_jwt authentication is not enabled');
    }
    authMethod = 'client_secret_jwt';
    verifyKey = new TextEncoder().encode(row.clientSecret);
  } else if (header.alg === 'RS256' || header.alg === 'ES256') {
    if (!isEnabled('privateKeyJwt')) {
      throw new OAuthError('invalid_client', 401, 'private_key_jwt authentication is not enabled');
    }
    authMethod = 'private_key_jwt';
    if (row.jwks) {
      verifyKey = jose.createLocalJWKSet(JSON.parse(row.jwks));
    } else if (row.jwksUri) {
      verifyKey = jose.createRemoteJWKSet(new URL(row.jwksUri));
    } else {
      throw new OAuthError('invalid_client', 401, 'Client has no jwks configured for private_key_jwt');
    }
  } else {
    throw new OAuthError('invalid_client', 401, `Unsupported client_assertion alg: ${header.alg}`);
  }

  const issuer = config.APP_URL;
  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(assertion, verifyKey as any, {
      algorithms: [header.alg],
      audience: [issuer, `${issuer}/api/oidc/token`],
      maxTokenAge: '5m',
    }));
  } catch {
    throw new OAuthError('invalid_client', 401, 'client_assertion signature or claims are invalid');
  }

  const jti = typeof payload.jti === 'string' ? payload.jti : undefined;
  if (!jti) throw new OAuthError('invalid_client', 401, 'client_assertion is missing jti');

  try {
    await db.insert(clientAssertionJtis).values({ jti, clientId, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  } catch {
    // Unique constraint violation on jti — this assertion has already been used.
    throw new OAuthError('invalid_client', 401, 'client_assertion has already been used');
  }

  enforceAuthMethodCategory(row.tokenEndpointAuthMethod, authMethod);

  return { row, clientId: row.clientId, tenantId, authMethod, grantTypes: parseList(row.grantTypes), allowedScopes: parseList(row.allowedScopes) };
}

export async function authenticateClient(req: Request): Promise<AuthenticatedClient> {
  const tenantId = req.tenantId!;

  if (req.body?.client_assertion_type === CLIENT_ASSERTION_TYPE) {
    return authenticateViaClientAssertion(req, tenantId);
  }

  const bodyClientId = typeof req.body?.client_id === 'string' ? req.body.client_id : undefined;
  const bodyClientSecret = typeof req.body?.client_secret === 'string' ? req.body.client_secret : undefined;
  const authHeader = req.headers['authorization'];
  const basic = authHeader ? parseBasicAuth(authHeader) : null;

  if (basic && bodyClientSecret) {
    throw new OAuthError('invalid_request', 400, 'Client authentication must use exactly one method');
  }

  let clientId: string;
  let clientSecret: string | undefined;
  let authMethod: ClientAuthMethod;

  if (basic) {
    clientId = basic.clientId;
    clientSecret = basic.clientSecret;
    authMethod = 'client_secret_basic';
  } else if (bodyClientId) {
    clientId = bodyClientId;
    clientSecret = bodyClientSecret;
    authMethod = 'client_secret_post';
  } else {
    throw new OAuthError('invalid_client', 401, 'Client authentication required');
  }

  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.clientId, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!row || !clientSecret || !(await verifyClientSecret(row, clientSecret))) {
    throw new OAuthError('invalid_client', 401, 'Invalid client credentials');
  }

  enforceAuthMethodCategory(row.tokenEndpointAuthMethod, authMethod);

  return {
    row,
    clientId: row.clientId,
    tenantId,
    authMethod,
    grantTypes: parseList(row.grantTypes),
    allowedScopes: parseList(row.allowedScopes),
  };
}
