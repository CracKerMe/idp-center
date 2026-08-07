<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { startRegistration } from '@simplewebauthn/browser'
import { useAuthStore, type MfaFactor } from '../stores/auth'

const authStore = useAuthStore()

const factors = ref<MfaFactor[]>([])
const recoveryRemaining = ref(0)
const loading = ref(true)
const error = ref('')
const message = ref('')

// TOTP setup (one-shot prompt() flow, mirrors src/components/MfaFactorsManager.tsx)
const totpSecret = ref<string | null>(null)
const totpFactorId = ref<string | null>(null)
const totpCode = ref('')

// Email factor setup
const emailStep = ref<'idle' | 'code'>('idle')
const emailFactorId = ref<string | null>(null)
const emailCode = ref('')

// Recovery codes modal
const recoveryCodes = ref<string[] | null>(null)

// Disable modal
const disableFactorId = ref<string | null>(null)
const disablePassword = ref('')

const FACTOR_LABELS: Record<string, string> = {
  totp: 'Authenticator App',
  email: 'Email Code',
  sms: 'SMS Code',
  webauthn: 'Security Key',
  recovery: 'Recovery Code',
}

async function refresh() {
  loading.value = true
  try {
    const result = await authStore.getMfaFactors()
    factors.value = result.factors.filter(f => f.type !== 'recovery')
    recoveryRemaining.value = result.recovery_codes_remaining
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to load MFA factors'
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

async function handleAddTotp() {
  error.value = ''
  message.value = ''
  try {
    const result = await authStore.totpSetup()
    totpSecret.value = result.secret
    totpFactorId.value = result.factorId
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to start authenticator app setup'
  }
}

async function handleConfirmTotp() {
  if (!totpFactorId.value) return
  error.value = ''
  try {
    await authStore.totpConfirm(totpFactorId.value, totpCode.value)
    message.value = 'Authenticator app enabled'
    totpSecret.value = null
    totpFactorId.value = null
    totpCode.value = ''
    await refresh()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Invalid code'
  }
}

async function handleStartEmail() {
  error.value = ''
  message.value = ''
  try {
    const result = await authStore.emailFactorSetup()
    emailFactorId.value = result.factorId
    emailStep.value = 'code'
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to send email code'
  }
}

async function handleConfirmEmail() {
  if (!emailFactorId.value) return
  error.value = ''
  try {
    await authStore.emailFactorConfirm(emailFactorId.value, emailCode.value)
    message.value = 'Email verification enabled'
    emailStep.value = 'idle'
    emailCode.value = ''
    emailFactorId.value = null
    await refresh()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Invalid or expired code'
  }
}

async function handleAddWebauthn() {
  error.value = ''
  message.value = ''
  try {
    const options = await authStore.webauthnRegisterOptions()
    const attestation = await startRegistration({ optionsJSON: options.options })
    await authStore.webauthnRegisterVerify(options.factorId, attestation)
    message.value = 'Security key registered'
    await refresh()
  } catch (err: any) {
    error.value = err.response?.data?.error || err.message || 'Security key registration failed'
  }
}

async function handleGenerateRecoveryCodes() {
  error.value = ''
  message.value = ''
  try {
    recoveryCodes.value = await authStore.generateRecoveryCodes()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to generate recovery codes'
  }
}

function closeRecoveryModal() {
  recoveryCodes.value = null
  refresh()
}

async function handleDisable() {
  if (!disableFactorId.value) return
  error.value = ''
  try {
    await authStore.disableMfaFactor(disableFactorId.value, disablePassword.value)
    message.value = 'MFA factor disabled'
    disableFactorId.value = null
    disablePassword.value = ''
    await refresh()
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to disable factor'
  }
}
</script>

<template>
  <div class="page-container">
    <div class="section-header mb-12">
      <div>
        <span class="section-badge mb-4">Security Hardening</span>
        <h1>Multi-Factor Authentication</h1>
        <p class="text-muted">Register authenticators, security keys, and recovery codes for your account.</p>
      </div>
    </div>

    <transition name="fade">
      <div v-if="error" class="error-message mb-6"><span style="margin-right: 8px;">⚠️</span>{{ error }}</div>
    </transition>
    <transition name="fade">
      <div v-if="message" class="success-message mb-6"><span style="margin-right: 8px;">✅</span>{{ message }}</div>
    </transition>

    <section class="premium-card mb-8">
      <h3 class="mb-6">Active Factors</h3>

      <div v-if="loading" class="loading-overlay"><div class="spinner"></div></div>
      <div v-else-if="!factors.length" class="empty-state">
        <p class="text-muted">No MFA factors configured yet.</p>
      </div>
      <div v-else class="factors-list">
        <div v-for="f in factors" :key="f.id" class="factor-row">
          <div>
            <strong>{{ f.name || FACTOR_LABELS[f.type] || f.type }}</strong>
            <p class="text-xs text-muted mb-0">{{ FACTOR_LABELS[f.type] || f.type }} · Active</p>
          </div>
          <button class="btn btn-secondary btn-sm" style="color: var(--error);" @click="disableFactorId = f.id">
            Disable
          </button>
        </div>
      </div>

      <div class="flex flex-wrap gap-3 mt-8">
        <button class="btn btn-secondary" @click="handleAddTotp">Add authenticator app</button>
        <button v-if="emailStep === 'idle'" class="btn btn-secondary" @click="handleStartEmail">Add email code</button>
        <button class="btn btn-secondary" @click="handleAddWebauthn">Add security key</button>
        <button class="btn btn-secondary" @click="handleGenerateRecoveryCodes">
          {{ recoveryRemaining > 0 ? `Regenerate recovery codes (${recoveryRemaining} left)` : 'Generate recovery codes' }}
        </button>
      </div>

      <!-- TOTP secret + confirm -->
      <form v-if="totpSecret" class="inline-panel mt-6" @submit.prevent="handleConfirmTotp">
        <p class="text-sm">Scan this secret in your authenticator app, then enter the 6-digit code:</p>
        <code class="secret-code">{{ totpSecret }}</code>
        <input v-model="totpCode" type="text" inputmode="numeric" required placeholder="6-digit code" class="form-input mt-3 mb-3" />
        <button type="submit" class="btn btn-primary">Verify &amp; Enable</button>
      </form>

      <!-- Email code confirm -->
      <form v-if="emailStep === 'code'" class="inline-panel mt-6" @submit.prevent="handleConfirmEmail">
        <input v-model="emailCode" type="text" inputmode="numeric" required placeholder="6-digit code sent to your email" class="form-input mb-3" />
        <button type="submit" class="btn btn-primary">Verify</button>
      </form>
    </section>

    <!-- Recovery codes modal -->
    <div v-if="recoveryCodes" class="modal-backdrop">
      <div class="modal-card">
        <h4>Save your recovery codes</h4>
        <p class="text-sm text-muted">
          Each code can be used once if you lose access to your other MFA methods. Store them somewhere safe — they will not be shown again.
        </p>
        <div class="codes-grid">
          <span v-for="c in recoveryCodes" :key="c">{{ c }}</span>
        </div>
        <button class="btn btn-primary" style="width: 100%;" @click="closeRecoveryModal">I've saved these codes</button>
      </div>
    </div>

    <!-- Disable factor modal -->
    <div v-if="disableFactorId" class="modal-backdrop">
      <form class="modal-card" @submit.prevent="handleDisable">
        <h4>Confirm your password</h4>
        <input v-model="disablePassword" type="password" required autofocus placeholder="Password" class="form-input mb-4" />
        <div style="display: flex; justify-content: flex-end; gap: var(--space-3);">
          <button type="button" class="btn btn-secondary" @click="disableFactorId = null; disablePassword = ''">Cancel</button>
          <button type="submit" class="btn btn-primary" style="background: var(--error); border-color: var(--error);">Disable</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.factors-list { display: flex; flex-direction: column; gap: var(--space-3); }
.factor-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: var(--space-4); background: var(--slate-50); border-radius: var(--radius-lg);
}
.empty-state { text-align: center; padding: var(--space-8); color: var(--slate-400); }
.inline-panel { padding: var(--space-4); background: var(--slate-50); border-radius: var(--radius-lg); }
.secret-code { display: block; padding: var(--space-3); background: white; border-radius: var(--radius-md); font-size: 0.8rem; word-break: break-all; margin: var(--space-2) 0; }
.success-message { padding: var(--space-3) var(--space-4); background: #f0fdf4; color: #15803d; border-radius: var(--radius-lg); border: 1px solid #bbf7d0; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; padding: var(--space-4); }
.modal-card { background: white; border-radius: var(--radius-lg); padding: var(--space-6); max-width: 420px; width: 100%; }
.codes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); font-family: monospace; font-size: 0.85rem; background: var(--slate-50); border-radius: var(--radius-md); padding: var(--space-4); margin: var(--space-4) 0; }
.btn-sm { font-size: 0.75rem; padding: 6px 12px; height: auto; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
