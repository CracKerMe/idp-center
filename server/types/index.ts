export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  tenant_id: string;
  is_active: number;
  is_admin: number;
  otp_secret: string | null;
  otp_enabled: number;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  password_changed_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  email_verified: number;
  email_verified_at: string | null;
  must_change_password: number;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  client_id: string;
  client_secret: string;
  client_name: string;
  redirect_uris: string;
  grant_types: string;
  tenant_id: string;
  created_at: string;
}

export interface RefreshToken {
  id: string;
  token: string;
  user_id: string;
  client_id: string | null;
  expires_at: string;
  revoked: number;
  remember_me: number;
  device_id: string | null;
  created_at: string;
}

export interface AuthCode {
  id: string;
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  expires_at: string;
  used: number;
  nonce: string | null;
  scope: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
}

export interface AccessToken {
  id: string;
  token: string;
  client_id: string;
  user_id: string;
  expires_at: string;
  revoked: number;
  scope: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  device_info: string | null;
  ip_address: string | null;
  last_active: string;
  created_at: string;
}

export interface Tenant {
  id: string;
  name: string;
  domain: string | null;
  is_active: number;
  settings: string;
  created_at: string;
}

export interface EmailVerification {
  id: string;
  user_id: string;
  token: string;
  type: string;
  new_email: string | null;
  expires_at: string;
  used: number;
  created_at: string;
}

export interface PasswordReset {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  used: number;
  created_at: string;
}

export interface TrustedDevice {
  id: string;
  user_id: string;
  device_fingerprint: string;
  device_name: string | null;
  trusted_at: string;
  expires_at: string;
  last_used_at: string | null;
}

export interface AccountDeletionRequest {
  id: string;
  user_id: string;
  requested_at: string;
  scheduled_delete_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
  status: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  tenant_id: string | null;
  action: string;
  ip_address: string | null;
  user_agent: string | null;
  details: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Legacy SQLite-era type interfaces.
// Only JwtUserPayload is still imported (by server/middleware/auth.ts).
// The rest are unused pre-PostgreSQL leftovers — kept temporarily for reference.
// ---------------------------------------------------------------------------

export interface JwtUserPayload {
  id: string;
  username: string;
  is_admin: boolean;
  tenant_id: string;
  /** Browser session id — embedded at login (server/routes/auth.ts completeLogin) */
  bsid?: string;
  /** RFC 8176 auth method references, e.g. ['pwd'] or ['pwd','otp'] */
  amr?: string[];
  /** Authentication context class reference — '0' password-only, '1' password+MFA */
  acr?: string;
  /** Token subject type: 'user' for normal tokens, 'client' for client_credentials */
  sub_type?: 'user' | 'client';
  /** DPoP confirmation (RFC 9449) */
  cnf?: { jkt?: string };
  /** Unique token id */
  jti?: string;
}
