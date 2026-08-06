import type { Request, Response } from 'express';
import type { clients } from '../schema.js';

export type ClientAuthMethod =
  | 'client_secret_post'
  | 'client_secret_basic'
  | 'client_secret_jwt'
  | 'private_key_jwt'
  | 'none';

export interface AuthenticatedClient {
  row: typeof clients.$inferSelect;
  clientId: string;
  tenantId: string;
  authMethod: ClientAuthMethod;
  grantTypes: string[];
  allowedScopes: string[];
}

export interface GrantContext {
  req: Request;
  res: Response;
  params: Record<string, any>;
  client: AuthenticatedClient;
  tenantId: string;
  grantType: string;
  now: Date;
}

export type TokenResponse = Record<string, any>;

export interface GrantHandler {
  grantType: string;
  requiresClientAuth: boolean;
  allowedAuthMethods?: ClientAuthMethod[];
  handle(ctx: GrantContext): Promise<TokenResponse>;
}
