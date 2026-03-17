import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http from '../utils/http'

interface User {
  id: string
  username: string
  email: string
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

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isInitialized = ref(false)

  const isAuthenticated = computed(() => !!token.value)

  // Direct login (username/password)
  async function login(username: string, password: string, otp?: string): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      console.log('=== Login request ===')
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password, otp })
      })

      const data = await response.json()
      console.log('Login response:', data)
      console.log('Response status:', response.status)
      console.log('access_token:', data.access_token)
      console.log('refresh_token:', data.refresh_token)
      console.log('user:', data.user)

      if (!response.ok) {
        if (data.requireOtp) {
          throw new Error('OTP_REQUIRED')
        }
        throw new Error(data.error || 'Login failed')
      }

      // Store tokens
      console.log('Storing token to localStorage...')
      token.value = data.access_token
      user.value = data.user
      localStorage.setItem('token', data.access_token)
      console.log('Token stored:', localStorage.getItem('token'))
      
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token)
      }
      
      if (data.session_id) {
        localStorage.setItem('session_id', data.session_id)
      }
      
      isInitialized.value = true

      console.log('=== Login completed successfully ===')
      return true
    } catch (err: any) {
      console.error('Login error:', err)
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
        user.value = response.data
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

      const data = await response.json()

      if (!response.ok) {
        console.error('Token refresh failed:', data.error)
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
      return response.data
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

  // OAuth2 Authorization Code Flow - Step 1: Redirect to authorization
  function startOAuthFlow(clientId: string, redirectUri: string, state?: string): void {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state: state || generateRandomState()
    })

    // Redirect to IDP Center's authorization page (hash mode)
    window.location.href = `http://localhost:5986/#/authorize?${params.toString()}`
  }

  // OAuth2 Authorization Code Flow - Step 2: Exchange code for token
  async function exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<TokenData> {
    loading.value = true
    error.value = null

    try {
      console.log('=== OAuth Token Exchange ===')
      console.log('Code:', code)
      console.log('Client ID:', clientId)
      console.log('Redirect URI:', redirectUri)

      const response = await http.post('/oidc/token', {
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      })

      const data = response.data
      console.log('Token exchange response:', data)

      // Store tokens
      token.value = data.access_token
      localStorage.setItem('token', data.access_token)
      
      if (data.refresh_token) {
        console.log('Storing refresh token')
        localStorage.setItem('refresh_token', data.refresh_token)
      }

      // Store user info from token response
      if (data.user) {
        console.log('Storing user info:', data.user)
        user.value = data.user
      }

      console.log('=== OAuth Token Exchange Completed ===')
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

  // Generate random state for OAuth
  function generateRandomState(): string {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
  }

  return {
    user,
    token,
    loading,
    error,
    isInitialized,
    isAuthenticated,
    login,
    register,
    checkAuth,
    logout,
    refreshAccessToken,
    getSessions,
    revokeSession,
    startOAuthFlow,
    exchangeCodeForToken,
    fetchUserInfo
  }
})
