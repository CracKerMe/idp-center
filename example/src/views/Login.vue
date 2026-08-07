<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore, MfaRequiredError, type MfaFactor } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

// MFA step state — populated when login() throws MfaRequiredError.
// server/routes/auth.ts: TOTP/recovery codes verify directly at /mfa/verify; email/sms
// need a POST /mfa/challenge first to actually send the code.
const mfaToken = ref('')
const mfaFactors = ref<MfaFactor[]>([])
const selectedFactor = ref<MfaFactor | null>(null)
const mfaCode = ref('')
const codeSent = ref(false)

const FACTOR_LABELS: Record<MfaFactor['type'], string> = {
  totp: 'Authenticator App (TOTP)',
  email: 'Email Code',
  sms: 'SMS Code',
  webauthn: 'Security Key (WebAuthn)',
}

async function handleSubmit() {
  error.value = ''
  loading.value = true

  try {
    const success = await authStore.login(username.value, password.value)
    if (success) {
      const redirect = route.query.redirect as string
      await router.push(redirect || '/dashboard')
    }
  } catch (err: any) {
    if (err instanceof MfaRequiredError) {
      mfaToken.value = err.mfaToken
      mfaFactors.value = err.factors
      // Only one factor on file — skip straight to entering the code.
      if (err.factors.length === 1) {
        await selectFactor(err.factors[0])
      }
    } else {
      error.value = err.message
    }
  } finally {
    loading.value = false
  }
}

async function selectFactor(factor: MfaFactor) {
  error.value = ''
  selectedFactor.value = factor
  mfaCode.value = ''
  codeSent.value = false

  if (factor.type === 'email' || factor.type === 'sms') {
    loading.value = true
    try {
      await authStore.mfaChallenge(mfaToken.value, factor.id)
      codeSent.value = true
    } catch (err: any) {
      error.value = err.message
      selectedFactor.value = null
    } finally {
      loading.value = false
    }
  } else if (factor.type === 'webauthn') {
    error.value = 'This demo does not implement the WebAuthn ceremony — pick another factor or use the main app UI.'
    selectedFactor.value = null
  }
  // totp: nothing to do, just show the code input.
}

async function handleMfaVerify() {
  if (!selectedFactor.value) return
  error.value = ''
  loading.value = true

  try {
    const success = await authStore.mfaVerify(mfaToken.value, selectedFactor.value.id, mfaCode.value)
    if (success) {
      const redirect = route.query.redirect as string
      await router.push(redirect || '/dashboard')
    }
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function backToFactorList() {
  selectedFactor.value = null
  mfaCode.value = ''
  error.value = ''
}

function handleOAuthLogin() {
  authStore.beginOAuthLogin(route.query.redirect as string)
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
          <h2 class="mb-2">{{ mfaFactors.length ? 'Two-Factor Verification' : 'Welcome Back' }}</h2>
          <p class="text-sm text-muted">
            {{ mfaFactors.length ? 'Confirm your identity with a second factor.' : 'Sign in to access your secure identity portal.' }}
          </p>
        </div>

        <transition name="fade">
          <div v-if="error" class="error-message">
            <span style="margin-right: 8px;">⚠️</span> {{ error }}
          </div>
        </transition>

        <!-- Step 1: username/password -->
        <form v-if="!mfaFactors.length" @submit.prevent="handleSubmit">
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

        <!-- Step 2a: pick a factor (only shown with >1 factor on file) -->
        <div v-else-if="!selectedFactor" class="form-group">
          <button
            v-for="factor in mfaFactors"
            :key="factor.id"
            type="button"
            class="btn btn-secondary"
            style="width: 100%; margin-bottom: var(--space-3); height: 48px; justify-content: flex-start;"
            :disabled="loading"
            @click="selectFactor(factor)"
          >
            {{ factor.name || FACTOR_LABELS[factor.type] || factor.type }}
          </button>
        </div>

        <!-- Step 2b: enter the code for the chosen factor -->
        <form v-else @submit.prevent="handleMfaVerify">
          <div class="form-group">
            <label class="form-label">
              {{ FACTOR_LABELS[selectedFactor.type] || selectedFactor.type }}
              <span v-if="codeSent" class="text-xs text-muted">— code sent</span>
            </label>
            <input
              v-model="mfaCode"
              type="text"
              class="form-input"
              required
              placeholder="6-digit code"
              maxlength="10"
              autofocus
            />
          </div>

          <button
            type="submit"
            class="btn btn-primary btn-glow"
            style="width: 100%; margin-top: var(--space-4); height: 48px;"
            :disabled="loading"
          >
            <span v-if="loading" class="spinner" style="width: 18px; height: 18px; border-width: 2px; margin-right: 8px;"></span>
            {{ loading ? 'Verifying...' : 'Verify' }}
          </button>

          <button
            v-if="mfaFactors.length > 1"
            type="button"
            class="btn btn-secondary"
            style="width: 100%; margin-top: var(--space-3); height: 40px;"
            @click="backToFactorList"
          >
            Use a different factor
          </button>
        </form>

        <template v-if="!mfaFactors.length">
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
                <strong>Dev Access:</strong> the admin password is randomly generated on the
                main app's first boot and printed to its console — there is no fixed default
                anymore. Register a new account here to try the demo without it.
              </p>
            </div>
          </div>
        </template>
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
