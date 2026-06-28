export interface AuthUser {
  id: string;
  username: string;
  email: string;
  is_admin: number;
  otp_enabled: number;
  tenant_id: string;
  must_change_password?: number;
  [key: string]: unknown;
}
