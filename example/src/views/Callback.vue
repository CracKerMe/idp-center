<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const error = ref('')
const loading = ref(true)

function safeReturnTo(returnTo: string | undefined, fallback = '/dashboard') {
  if (!returnTo) return fallback
  if (!returnTo.startsWith('/')) return fallback
  if (returnTo.startsWith('//')) return fallback
  if (returnTo.includes('://')) return fallback
  return returnTo
}

onMounted(async () => {
  const code = route.query.code as string
  const state = route.query.state as string
  const errorParam = route.query.error as string

  if (errorParam) {
    error.value = (route.query.error_description as string) || errorParam
    loading.value = false
    return
  }

  if (!state) {
    error.value = 'Identity protocol failure: Missing state packet.'
    loading.value = false
    return
  }

  // Validates state + TTL and returns the PKCE verifier stashed by beginOAuthLogin().
  const record = authStore.consumeOAuthState(state)
  if (!record) {
    error.value = 'Session expired or invalid state synchronization.'
    loading.value = false
    return
  }

  if (!code) {
    error.value = 'Missing authorization grant (code_not_found).'
    loading.value = false
    return
  }

  try {
    await authStore.exchangeCodeForToken(code, record.verifier)
    router.replace(safeReturnTo(record.return_to))
  } catch (err: any) {
    console.error('OAuth callback error:', err)
    error.value = err.message || 'Back-channel exchange failed.'
    loading.value = false
  }
})
</script>

<template>
  <div class="auth-page-background">
    <div class="auth-container">
      <div class="premium-card glass-v2 text-center" style="padding: var(--space-12) var(--space-8);">
        <div v-if="loading" class="verification-state">
          <div class="spinner mb-8" style="width: 48px; height: 48px; border-width: 4px;"></div>
          <h2 class="mb-4">Identity Handshake</h2>
          <p class="text-sm text-muted">Exchanging authorization grants and validating PKCE signatures...</p>
          <div class="loading-state-inline mt-10">
            <span class="text-xs font-bold text-muted uppercase tracking-widest">Negotiating Security Protocol</span>
          </div>
        </div>
        
        <transition name="scale">
          <div v-else-if="error" class="verification-state">
            <div class="status-icon error mb-8">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 class="mb-4" style="color: var(--error);">Exchange Failed</h3>
            <p class="text-sm text-muted mb-10" style="max-width: 320px; margin-inline: auto;">{{ error }}</p>
            <router-link to="/" class="btn btn-primary" style="width: 100%;">
              Back to Home Base
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
  background: rgba(239, 68, 68, 0.1);
  color: var(--error);
  box-shadow: 0 0 30px rgba(239, 68, 68, 0.2);
}

.status-icon svg { width: 40px; height: 40px; }

.loading-state-inline {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  justify-content: center;
}

.scale-enter-active { transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
.scale-enter-from { opacity: 0; transform: scale(0.8); }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
