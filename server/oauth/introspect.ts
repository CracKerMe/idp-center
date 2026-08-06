import type { Request, Response } from 'express';
import { authenticateClient } from './client-auth.js';
import { resolveToken } from './token-lookup.js';
import { OAuthError, sendOAuthError } from './errors.js';
import { tokenIntrospect } from '../utils/metrics.js';

/** RFC 7662 token introspection. */
export async function handleIntrospect(req: Request, res: Response): Promise<void> {
  try {
    const client = await authenticateClient(req);

    const token = req.body?.token;
    if (!token) throw new OAuthError('invalid_request', 400, 'token is required');

    const hint = req.body?.token_type_hint === 'refresh_token' ? 'refresh_token' : req.body?.token_type_hint === 'access_token' ? 'access_token' : undefined;
    const resolved = await resolveToken(token, client.tenantId, hint);

    if (!resolved) {
      tokenIntrospect.inc({ active: 'false', tenant_id: client.tenantId });
      res.json({ active: false });
      return;
    }

    // Cross-client introspection is a real information leak: only the token's own client,
    // or a client explicitly marked as a resource server, may introspect it.
    const owned = resolved.row.clientId === client.clientId;
    const canIntrospectAny = client.row.isResourceServer === true;
    if (!owned && !canIntrospectAny) {
      tokenIntrospect.inc({ active: 'false', tenant_id: client.tenantId });
      res.json({ active: false });
      return;
    }

    if (resolved.row.revoked || resolved.row.expiresAt < new Date()) {
      tokenIntrospect.inc({ active: 'false', tenant_id: client.tenantId });
      res.json({ active: false });
      return;
    }

    tokenIntrospect.inc({ active: 'true', tenant_id: client.tenantId });

    if (resolved.kind === 'access') {
      const row = resolved.row;
      res.json({
        active: true,
        scope: row.scope || 'openid',
        client_id: row.clientId,
        token_type: 'Bearer',
        exp: Math.floor(row.expiresAt.getTime() / 1000),
        iat: row.createdAt ? Math.floor(row.createdAt.getTime() / 1000) : undefined,
        sub: row.userId,
        tenant_id: row.tenantId,
      });
      return;
    }

    const row = resolved.row;
    res.json({
      active: true,
      scope: row.scope || 'openid',
      client_id: row.clientId,
      token_type: 'refresh_token',
      exp: Math.floor(row.expiresAt.getTime() / 1000),
      iat: row.createdAt ? Math.floor(row.createdAt.getTime() / 1000) : undefined,
      sub: row.userId,
      tenant_id: row.tenantId,
    });
  } catch (err) {
    sendOAuthError(res, err);
  }
}
