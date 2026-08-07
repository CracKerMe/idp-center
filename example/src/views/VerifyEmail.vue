<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const loading = ref(true)
const status = ref<'verifying' | 'success' | 'error'>('verifying')
const message = ref('')

onMounted(async () => {
  const token = route.query.token as string
  if (!token) {
    status.value = 'error'
    message.value = 'Security error: No verification packet detected in the request.'
    loading.value = false
    return
  }

  try {
    await authStore.verifyEmail(token)
    status.value = 'success'
    message.value = 'Identity confirmed! Your digital signature has been verified across the cluster.'
    
    setTimeout(() => {
      router.push('/dashboard')
    }, 4000)
  } catch (err: any) {
    status.value = 'error'
    message.value = err.response?.data?.error || err.message || 'Validation failed. The link integrity may be compromised or expired.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="auth-page-background">
    <div class="auth-container">
      <div class="premium-card glass-v2 text-center" style="padding: var(--space-12) var(--space-8);">
        <div class="header-logo" style="justify-content: center; margin-bottom: var(--space-8);">
          <span style="font-size: 2.5rem;">💌</span>
        </div>
        
        <h2 class="mb-4">Identity Verification</h2>

        <div v-if="loading" class="verification-state">
          <div class="spinner mb-6"></div>
          <p class="text-sm text-muted">Decoding verification tokens and synchronizing nodes...</p>
        </div>

        <transition name="scale">
          <div v-if="status === 'success'" class="verification-state">
            <div class="status-icon success mb-8">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 class="mb-4 text-gradient">Access Granted</h3>
            <p class="text-sm text-muted mb-10" style="max-width: 320px; margin-inline: auto;">
              {{ message }}
            </p>
            <div class="loading-state-inline justify-center">
              <div class="spinner-sm"></div>
              <span class="text-xs font-bold text-muted uppercase tracking-widest">Entering Dashboard</span>
            </div>
          </div>
        </transition>

        <transition name="scale">
          <div v-if="status === 'error'" class="verification-state">
            <div class="status-icon error mb-8">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 class="mb-4" style="color: var(--error);">Validation Failure</h3>
            <p class="text-sm text-muted mb-10" style="max-width: 320px; margin-inline: auto;">
              {{ message }}
            </p>
            <router-link to="/dashboard" class="btn btn-primary" style="width: 100%;">
              Access Safe Zone
            </router-link>
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.verification-state {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.status-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.status-icon svg { width: 40px; height: 40px; }

.status-icon.success {
  background: rgba(16, 185, 129, 0.1);
  color: var(--success);
  box-shadow: 0 0 30px rgba(16, 185, 129, 0.2);
}

.status-icon.error {
  background: rgba(239, 68, 68, 0.1);
  color: var(--error);
  box-shadow: 0 0 30px rgba(239, 68, 68, 0.2);
}

.loading-state-inline {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid var(--slate-100);
  border-top-color: var(--primary-600);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.scale-enter-active { transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
.scale-enter-from { opacity: 0; transform: scale(0.8); }

.justify-center { justify-content: center; }
</style>
