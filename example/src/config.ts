/**
 * Central OAuth client config. Reads from `.env` (see `.env.example`) with dev-friendly
 * fallbacks. `default-client`'s secret is generated randomly by the main app on first boot
 * (server/database.ts) — there is no fixed value to fall back to, so VITE_CLIENT_SECRET must
 * be set for the OAuth2/OIDC demo flow to work; the direct login flow does not need it.
 */
export const OAUTH_CONFIG = {
  idpBaseUrl: import.meta.env.VITE_IDP_CENTER_URL || 'http://localhost:5986',
  clientId: import.meta.env.VITE_CLIENT_ID || 'default-client',
  clientSecret: import.meta.env.VITE_CLIENT_SECRET || '',
  redirectUri: import.meta.env.VITE_REDIRECT_URI || `${window.location.origin}/callback`,
}
