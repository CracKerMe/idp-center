<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const otp = ref('')
const requireOtp = ref(false)
const error = ref('')
const loading = ref(false)

function safeReturnTo(returnTo: string | undefined, fallback = '/dashboard') {
  if (!returnTo) return fallback
  if (!returnTo.startsWith('/')) return fallback
  if (returnTo.startsWith('//')) return fallback
  if (returnTo.includes('://')) return fallback
  return returnTo
}

function generateNonce() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function generatePKCE() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const verifier = btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const challenge = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(hash))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return { verifier, challenge }
}

async function startOAuthFlow(returnTo?: string) {
  const clientId = 'default-client'
  const redirectUri = 'http://localhost:3000/callback'
  const nonce = generateNonce()
  const resolvedReturnTo = safeReturnTo(returnTo)
  const { verifier, challenge } = await generatePKCE()

  sessionStorage.setItem(
    `oauth_state:${nonce}`,
    JSON.stringify({ nonce, return_to: resolvedReturnTo, verifier, iat: Date.now() })
  )

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    state: nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })

  window.location.href = `http://localhost:5986/#/authorize?${params.toString()}`
}

function handleOAuthLogin() {
  const redirect = route.query.redirect as string
  startOAuthFlow(redirect)
}

async function handleSubmit() {
  error.value = ''
  loading.value = true

  try {
    const success = await authStore.login(username.value, password.value, otp.value || undefined)

    if (success) {
      const redirect = route.query.redirect as string
      await router.push(redirect || '/dashboard')
    }
  } catch (err: any) {
    if (err.message === 'OTP_REQUIRED') {
      requireOtp.value = true
      error.value = 'Security: Please enter your authenticator code'
    } else {
      error.value = err.message
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page-background">
    <div class="auth-container">
      <div class="premium-card glass-v2">
        <div class="text-center mb-8">
          <div class="header-logo" style="justify-content: center; margin-bottom: var(--space-4);">
            <span style="font-size: 2rem;">🛡️</span> IDP Center
          </div>
          <h2 class="mb-2">Welcome Back</h2>
          <p class="text-sm text-muted">Sign in to access your secure identity portal.</p>
        </div>
        
        <form @submit.prevent="handleSubmit">
          <transition name="fade">
            <div v-if="error" class="error-message">
              <span style="margin-right: 8px;">⚠️</span> {{ error }}
            </div>
          </transition>
          
          <div class="form-group">
            <label class="form-label">Username</label>
            <input
              v-model="username"
              type="text"
              class="form-input"
              required
              placeholder="Enter your username"
              autocomplete="username"
            />
          </div>
          
          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2);">
              <label class="form-label" style="margin-bottom: 0;">Password</label>
              <router-link to="/forgot-password" class="text-xs font-bold" style="color: var(--primary-600); text-decoration: none;">
                Forgot Secret?
              </router-link>
            </div>
            <input
              v-model="password"
              type="password"
              class="form-input"
              required
              placeholder="••••••••"
              autocomplete="current-password"
            />
          </div>
          
          <transition name="slide-down">
            <div v-if="requireOtp" class="form-group">
              <label class="form-label">Authenticator Code (2FA)</label>
              <input
                v-model="otp"
                type="text"
                class="form-input"
                required
                placeholder="6-digit code"
                maxlength="6"
                autofocus
              />
            </div>
          </transition>
          
          <button
            type="submit"
            class="btn btn-primary btn-glow"
            style="width: 100%; margin-top: var(--space-4); height: 48px;"
            :disabled="loading"
          >
            <span v-if="loading" class="spinner" style="width: 18px; height: 18px; border-width: 2px; margin-right: 8px;"></span>
            {{ loading ? 'Verifying...' : 'Sign In' }}
          </button>
        </form>

        <div class="separator mt-8 mb-8">
          <span class="separator-text">or continue with</span>
        </div>

        <div>
          <button
            type="button"
            class="btn btn-secondary"
            style="width: 100%; height: 48px;"
            @click="handleOAuthLogin"
          >
            <span style="margin-right: 8px;">🌐</span> Single Sign-On (SSO)
          </button>
        </div>

        <div class="text-center mt-10">
          <p class="text-sm">
            New to the platform?
            <router-link to="/register" style="color: var(--primary-600); text-decoration: none; font-weight: 800;">
              Create Identity
            </router-link>
          </p>
          <div style="margin-top: var(--space-6); padding: var(--space-4); background: var(--slate-50); border-radius: var(--radius-lg); border: 1px solid var(--slate-100);">
            <p class="text-xs text-muted mb-0">
              <strong>Dev Access:</strong> admin / Admin@IdpCenter2024!
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.separator {
  position: relative;
  text-align: center;
}

.separator::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--slate-200);
}

.separator-text {
  position: relative;
  background: white; /* Matches card bg in non-glass */
  padding: 0 var(--space-4);
  color: var(--slate-400);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.premium-card.glass-v2 .separator-text {
  background: transparent;
  backdrop-filter: blur(20px);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-down-enter-active { transition: all 0.3s ease-out; }
.slide-down-enter-from { opacity: 0; transform: translateY(-10px); }
</style>
