import type { Response } from 'express';

/** RFC 6749 §5.2 shaped OAuth error — no `code`, no response envelope. */
export class OAuthError extends Error {
  status: number;
  error: string;
  error_description?: string;

  constructor(error: string, status = 400, description?: string) {
    super(description || error);
    this.error = error;
    this.status = status;
    this.error_description = description;
  }
}

export function sendOAuthError(res: Response, err: unknown) {
  if (err instanceof OAuthError) {
    const body: Record<string, string> = { error: err.error };
    if (err.error_description) body.error_description = err.error_description;
    if (err.error === 'invalid_client') res.set('WWW-Authenticate', 'Basic');
    return res.status(err.status).json(body);
  }
  console.error('Unhandled OAuth grant error:', err);
  return res.status(500).json({ error: 'server_error' });
}
