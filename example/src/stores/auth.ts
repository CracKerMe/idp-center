import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http from '../utils/http'
import { OAUTH_CONFIG } from '../config'

interface User {
  id: string
  username: string
  email: string
  full_name?: string
  phone?: string
  avatar_url?: string
  is_admin?: boolean
  otp_enabled?: boolean
  tenant_id?: string
}

interface TokenData {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type: string
  expires_in: number
  session_id?: string
}

export interface MfaFactor {
  id: string
  type: 'totp' | 'email' | 'sms' | 'webauthn'
  name?: string
}

/**
 * Thrown by login() when POST /api/auth/login returns 403 AUTH_MFA_REQUIRED. The caller
 * (Login.vue) catches this specifically to switch to the factor-selection step instead of
 * showing a generic error — see server/routes/auth.ts's `completeLogin`/`mfa_token` flow.
 */
export class MfaRequiredError extends Error {
  mfaToken: string
  factors: MfaFactor[]
  constructor(mfaToken: string, factors: MfaFactor[]) {
    super('MFA verification required')
    this.name = 'MfaRequiredError'
    this.mfaToken = mfaToken
    this.factors = factors
  }
}

function randomState(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/** PKCE (RFC 7636, S256) — required by server/oauth/grants/authorization-code.ts whenever
 *  /authorize was called with a code_challenge, which every flow below always sends. */
async function generatePkce() {
  const verifierBytes = new Uint8Array(32)
  crypto.getRandomValues(verifierBytes)
  const verifier = base64url(verifierBytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(digest) }
}

function safeReturnTo(returnTo: string | undefined, fallback = '/dashboard'): string {
  if (!returnTo) return fallback
  if (!returnTo.startsWith('/')) return fallback
  if (returnTo.startsWith('//')) return fallback
  if (returnTo.includes('://')) return fallback
  return returnTo
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isInitialized = ref(false)

  const isAuthenticated = computed(() => !!token.value)

  /**
   * Stores a successful login/MFA-verify response's tokens — shared by login() (no MFA
   * enrolled) and mfaVerify() (MFA-enrolled), mirroring server/routes/auth.ts's
   * completeLogin() being the single token-issuance entrypoint for both paths.
   */
  function applySuccessfulAuth(data: any) {
    token.value = data.access_token
    user.value = data.user
    localStorage.setItem('token', data.access_token)
    if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token)
    if (data.session_id) localStorage.setItem('session_id', data.session_id)
    isInitialized.value = true
  }

  // Direct login (username/password). Throws MfaRequiredError when the account has an
  // active MFA factor — the caller must then drive mfaChallenge()/mfaVerify().
  async function login(username: string, password: string, opts?: { remember_me?: boolean; trust_device?: boolean }): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          remember_me: opts?.remember_me ?? false,
          trust_device: opts?.trust_device ?? false,
        })
      })

      const json = await response.json()
      const data = json.data

      if (!response.ok) {
        // 403 AUTH_MFA_REQUIRED — server/routes/auth.ts hands back a short-lived
        // mfa_token + the account's active factors instead of real tokens.
        if (response.status === 403 && json.code === 'AUTH_MFA_REQUIRED' && data?.mfa_token) {
          throw new MfaRequiredError(data.mfa_token, data.factors || [])
        }
        throw new Error(json.error || 'Login failed')
      }

      applySuccessfulAuth(data)
      return true
    } catch (err: any) {
      if (!(err instanceof MfaRequiredError)) {
        console.error('Login error:', err)
        error.value = err.message
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  // Sends a one-time code for factor types that need one (email/sms). TOTP, recovery codes
  // and WebAuthn are verified directly at mfaVerify() with no separate challenge step.
  async function mfaChallenge(mfaToken: string, factorId: string): Promise<void> {
    const response = await fetch('/api/auth/mfa/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfa_token: mfaToken, factor_id: factorId })
    })
    const json = await response.json()
    if (!response.ok) throw new Error(json.error || 'Failed to send verification code')
  }

  // Completes login after the second factor is verified.
  async function mfaVerify(mfaToken: string, factorId: string, code: string): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const response = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token: mfaToken, factor_id: factorId, code })
      })

      const json = await response.json()
      const data = json.data

      if (!response.ok) {
        throw new Error(json.error || 'Verification failed')
      }

      applySuccessfulAuth(data)
      return true
    } catch (err: any) {
      console.error('MFA verify error:', err)
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // Register new user
  async function register(username: string, email: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const response = await http.post('/auth/register', {
        username,
        email,
        password
      })

      return response.status === 200
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Registration failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  // Check authentication status
  async function checkAuth(): Promise<void> {
    if (!token.value) {
      isInitialized.value = true
      return
    }

    loading.value = true

    try {
      const response = await http.get('/auth/me')

      if (response.status === 200) {
        user.value = response.data.data ?? response.data
      } else {
        logout()
      }
    } catch {
      logout()
    } finally {
      loading.value = false
      isInitialized.value = true
    }
  }

  // Logout
  async function logout(): Promise<void> {
    try {
      // Call server logout API to revoke session and tokens
      const sessionId = localStorage.getItem('session_id')
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      
      if (token.value) {
        headers['Authorization'] = `Bearer ${token.value}`
      }
      if (sessionId) {
        headers['X-Session-Id'] = sessionId
      }

      await fetch('/api/auth/logout', {
        method: 'POST',
        headers
      })
    } catch (error) {
      console.error('Logout API error:', error)
      // Continue with local logout even if API fails
    } finally {
      // Clear local storage
      user.value = null
      token.value = null
      localStorage.removeItem('token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('session_id')
    }
  }

  // Refresh access token using refresh token
  async function refreshAccessToken(): Promise<boolean> {
    const refreshToken = localStorage.getItem('refresh_token')
    if (!refreshToken) {
      console.warn('No refresh token available')
      return false
    }

    loading.value = true
    error.value = null

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      })

      const json = await response.json()
      const data = json.data

      if (!response.ok) {
        console.error('Token refresh failed:', json.error)
        // Clear tokens on refresh failure
        logout()
        return false
      }

      // Store new tokens
      token.value = data.access_token
      localStorage.setItem('token', data.access_token)
      
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token)
      }

      console.log('Token refreshed successfully')
      return true
    } catch (err: any) {
      console.error('Token refresh error:', err)
      error.value = err.message
      logout()
      return false
    } finally {
      loading.value = false
    }
  }

  // Get active sessions
  async function getSessions() {
    try {
      const response = await http.get('/user/sessions')
      return response.data.data ?? response.data
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
      throw error
    }
  }
  
  // Revoke session (remote logout)
  async function revokeSession(sessionId: string) {
    try {
      await http.delete(`/user/sessions/${sessionId}`)
    } catch (error) {
      console.error('Failed to revoke session:', error)
      throw error
    }
  }

  const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

  // OAuth2 Authorization Code Flow, step 1: generate state + PKCE, stash them in
  // sessionStorage keyed by state so Callback.vue can validate/retrieve them, then redirect
  // to the IDP's hash-routed authorize page. This is the single implementation shared by
  // Home.vue and Login.vue's "Single Sign-On" buttons — do not re-duplicate this logic in
  // components, the nonce/PKCE bookkeeping is easy to get subtly wrong twice.
  async function beginOAuthLogin(returnTo?: string): Promise<void> {
    const state = randomState()
    const resolvedReturnTo = safeReturnTo(returnTo)
    const { verifier, challenge } = await generatePkce()

    sessionStorage.setItem(
      `oauth_state:${state}`,
      JSON.stringify({ state, return_to: resolvedReturnTo, verifier, iat: Date.now() })
    )

    const params = new URLSearchParams({
      client_id: OAUTH_CONFIG.clientId,
      redirect_uri: OAUTH_CONFIG.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    })

    // Hash route — the SPA is served with createHashHistory, see src/App.tsx on the main app.
    window.location.href = `${OAUTH_CONFIG.idpBaseUrl}/#/authorize?${params.toString()}`
  }

  /** Reads back and clears the state stashed by beginOAuthLogin(); null if invalid/expired/reused. */
  function consumeOAuthState(state: string): { return_to?: string; verifier?: string } | null {
    const key = `oauth_state:${state}`
    const saved = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    if (!saved) return null

    try {
      const record = JSON.parse(saved)
      if (record.state !== state || Date.now() - record.iat > OAUTH_STATE_TTL_MS) return null
      return record
    } catch {
      return null
    }
  }

  // OAuth2 Authorization Code Flow, step 2: exchange the code for tokens. client_secret
  // comes from OAUTH_CONFIG (see .env.example) — default-client's secret is generated
  // randomly by the main app on first boot, there is no working hardcoded fallback anymore.
  async function exchangeCodeForToken(code: string, codeVerifier?: string): Promise<TokenData> {
    loading.value = true
    error.value = null

    try {
      const payload: Record<string, any> = {
        grant_type: 'authorization_code',
        code,
        client_id: OAUTH_CONFIG.clientId,
        client_secret: OAUTH_CONFIG.clientSecret,
        redirect_uri: OAUTH_CONFIG.redirectUri
      }
      if (codeVerifier) payload.code_verifier = codeVerifier

      const response = await http.post('/oidc/token', payload)
      const data = response.data

      token.value = data.access_token
      localStorage.setItem('token', data.access_token)
      if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token)
      if (data.user) user.value = data.user

      return data
    } catch (err: any) {
      console.error('Token exchange error:', err)
      error.value = err.response?.data?.error || 'Token exchange failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  // Fetch user info using access token
  async function fetchUserInfo(accessToken: string): Promise<User> {
    try {
      const response = await http.get('/oidc/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      const userInfo = response.data
      user.value = {
        id: userInfo.sub,
        username: userInfo.name,
        email: userInfo.email
      }

      return user.value
    } catch (error) {
      console.error('Failed to fetch user info:', error)
      throw error
    }
  }

  // --- Advanced Flows ---

  // OTP Configuration
  async function setupOTP() {
    try {
      const response = await http.post('/auth/otp/setup')
      return response.data.data ?? response.data
    } catch (err: any) {
      console.error('Failed to setup OTP:', err)
      throw err
    }
  }

  async function verifyOTP(tokenStr: string) {
    try {
      const response = await http.post('/auth/otp/verify', { token: tokenStr })
      if (user.value) {
        user.value.otp_enabled = true
      }
      return response.data.data ?? response.data
    } catch (err: any) {
      console.error('Failed to verify OTP:', err)
      throw err
    }
  }

  // Trusted Devices
  async function getTrustedDevices() {
    try {
      const response = await http.get('/user/trusted-devices')
      return response.data.data ?? response.data
    } catch (err: any) {
      console.error('Failed to get trusted devices:', err)
      throw err
    }
  }

  async function revokeTrustedDevice(deviceId: string) {
    try {
      await http.delete(`/user/trusted-devices/${deviceId}`)
    } catch (err: any) {
      console.error('Failed to revoke trusted device:', err)
      throw err
    }
  }

  // Password Reset
  async function requestPasswordReset(email: string) {
    try {
      const response = await http.post('/auth/password/reset-request', { email })
      return response.data.data ?? response.data
    } catch (err: any) {
      console.error('Request password reset error:', err)
      throw err
    }
  }

  async function verifyPasswordResetToken(tokenStr: string) {
    try {
      const response = await http.post('/auth/password/reset-verify', { token: tokenStr })
      return response.data.data ?? response.data
    } catch (err: any) {
      console.error('Verify password reset token error:', err)
      throw err
    }
  }

  async function resetPassword(tokenStr: string, newPassword: string) {
    try {
      const response = await http.post('/auth/password/reset', { token: tokenStr, new_password: newPassword })
      return response.data.data ?? response.data
    } catch (err: any) {
      console.error('Reset password error:', err)
      throw err
    }
  }

  // Email Verification
  async function verifyEmail(tokenStr: string) {
    try {
      const response = await http.post('/auth/email/verify', { token: tokenStr })
      return response.data.data ?? response.data
    } catch (err: any) {
      console.error('Verify email error:', err)
      throw err
    }
  }

  async function resendVerificationEmail(email?: string, username?: string) {
    try {
      if (token.value) {
        // Authenticated flow
        const response = await http.post('/auth/email/resend')
        return response.data.data ?? response.data
      } else {
        // Public flow
        const payload: any = {}
        if (email) payload.email = email
        if (username) payload.username = username
        const response = await http.post('/auth/email/resend-public', payload)
        return response.data.data ?? response.data
      }
    } catch (err: any) {
      console.error('Resend verification email error:', err)
      throw err
    }
  }

  return {
    user,
    token,
    loading,
    error,
    isInitialized,
    isAuthenticated,
    login,
    mfaChallenge,
    mfaVerify,
    register,
    checkAuth,
    logout,
    refreshAccessToken,
    getSessions,
    revokeSession,
    beginOAuthLogin,
    consumeOAuthState,
    exchangeCodeForToken,
    fetchUserInfo,
    setupOTP,
    verifyOTP,
    getTrustedDevices,
    revokeTrustedDevice,
    requestPasswordReset,
    verifyPasswordResetToken,
    resetPassword,
    verifyEmail,
    resendVerificationEmail
  }
})
