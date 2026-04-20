<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()

const loading = ref(false)
const error = ref('')
const message = ref('')

const qrCodeUrl = ref('')
const secretKey = ref('')
const verifyCode = ref('')

onMounted(async () => {
  if (authStore.user?.otp_enabled) {
    message.value = 'Identity Hardening: Two-factor authentication is already active on your profile.'
    return
  }

  loading.value = true
  try {
    const data = await authStore.setupOTP()
    qrCodeUrl.value = data.qrcode_url || data.qrCodeUrl || ''
    secretKey.value = data.secret || ''
  } catch (err: any) {
    error.value = err.response?.data?.error || err.message || 'Transmission error: Failed to initialize security handshake.'
  } finally {
    loading.value = false
  }
})

async function submitVerify() {
  if (!verifyCode.value || verifyCode.value.length < 6) {
    error.value = 'Validation failed: Please enter a complete 6-digit sequence.'
    return
  }

  loading.value = true
  error.value = ''
  try {
    await authStore.verifyOTP(verifyCode.value)
    message.value = 'Protocol active: Multi-factor authentication successfully linked!'
    setTimeout(() => {
      router.push('/dashboard')
    }, 2000)
  } catch (err: any) {
    error.value = err.response?.data?.error || err.message || 'Handshake failed: Invalid signature detected.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page-container" style="max-width: 640px;">
    <div class="mb-10">
      <span class="section-badge mb-4">Security Protocol</span>
      <h1>Harden Identity</h1>
      <p class="text-muted">Add a second layer of defense to your global identity.</p>
    </div>

    <div class="premium-card glass-v2" style="padding: var(--space-10);">
      <div class="card-header-icon mb-6" style="font-size: 3rem;">🔐</div>
      <h3 class="mb-8">Multi-Factor Link (TOTP)</h3>

      <transition name="fade">
        <div v-if="error" class="error-message">
          <span style="margin-right: 8px;">⚠️</span> {{ error }}
        </div>
      </transition>
      
      <transition name="fade">
        <div v-if="message" class="success-message">
          <span style="margin-right: 8px;">🛡️</span> {{ message }}
        </div>
      </transition>

      <div v-if="loading && !qrCodeUrl" class="loading-overlay">
        <div class="spinner"></div>
      </div>

      <template v-else-if="qrCodeUrl && !authStore.user?.otp_enabled && !message">
        <div class="setup-grid">
          <div class="setup-step mb-8">
            <h4 class="mb-4" style="font-size: 1rem;"><span class="step-num">01</span> Synchronize Client</h4>
            <p class="text-xs text-muted mb-6">Scan this cryptographic signature with your authenticator node (e.g., Google Authenticator, Authy).</p>
            
            <div class="qr-container mb-4">
              <div class="qr-frame">
                <img :src="qrCodeUrl" alt="Security Seed" class="qr-image" />
              </div>
            </div>
            
            <div class="manual-backup">
              <span class="text-xs text-muted uppercase tracking-widest font-bold">Manual Seed</span>
              <code class="manual-key">{{ secretKey }}</code>
            </div>
          </div>

          <div class="setup-step">
            <h4 class="mb-4" style="font-size: 1rem;"><span class="step-num">02</span> Confirm Handshake</h4>
            <p class="text-xs text-muted mb-6">Transmit the 6-digit sequence from your node to finalize the link.</p>
            
            <div class="otp-input-wrapper mb-8">
              <input 
                v-model="verifyCode"
                type="text"
                class="form-input otp-field"
                placeholder="000 000"
                maxlength="6"
                autofocus
              />
            </div>
            
            <button 
              class="btn btn-primary btn-glow" 
              style="width: 100%; height: 48px;" 
              :disabled="loading"
              @click="submitVerify"
            >
              <span v-if="loading" class="spinner-sm" style="margin-right: 8px;"></span>
              {{ loading ? 'Linking...' : 'Secure Account' }}
            </button>
          </div>
        </div>
      </template>

      <div class="card-footer mt-10">
        <router-link to="/dashboard" class="text-sm" style="color: var(--primary-600); text-decoration: none; font-weight: 800;">
          &larr; Return to Secure Zone
        </router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.step-num {
  color: var(--primary-500);
  margin-right: 8px;
  font-family: monospace;
}

.qr-container {
  display: flex;
  justify-content: center;
}

.qr-frame {
  padding: var(--space-4);
  background: white;
  border: 1px solid var(--slate-100);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
}

.qr-image {
  display: block;
  max-width: 180px;
  mix-blend-mode: multiply;
}

.manual-backup {
  background: var(--slate-50);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--slate-100);
  text-align: center;
}

.manual-key {
  display: block;
  font-size: 1rem;
  font-weight: 800;
  color: var(--slate-900);
  letter-spacing: 0.1em;
  margin-top: 4px;
}

.otp-field {
  letter-spacing: 0.4em;
  text-align: center;
  font-size: 1.75rem;
  font-weight: 900;
  height: 64px;
  color: var(--primary-700);
  font-family: inherit;
}

.card-footer {
  border-top: 1px solid var(--slate-100);
  padding-top: var(--space-6);
  text-align: center;
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
