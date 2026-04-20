<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const loading = ref(true)
const submitting = ref(false)
const error = ref('')
const message = ref('')

const token = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const isTokenValid = ref(false)

onMounted(async () => {
  const tokenParam = route.query.token as string
  if (!tokenParam) {
    error.value = 'Invalid or missing security token.'
    loading.value = false
    return
  }
  
  token.value = tokenParam
  
  try {
    await authStore.verifyPasswordResetToken(token.value)
    isTokenValid.value = true
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Recovery link is invalid or has expired.'
  } finally {
    loading.value = false
  }
})

async function handleSubmit() {
  if (!newPassword.value || newPassword.value.length < 8) {
    error.value = 'Security requirement: Password must be at least 8 characters.'
    return
  }
  
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Verification failed: Passwords do not match.'
    return
  }

  submitting.value = true
  error.value = ''
  
  try {
    await authStore.resetPassword(token.value, newPassword.value)
    message.value = 'Access credentials updated successfully. Synchronizing identity...'
    setTimeout(() => {
      router.push('/login')
    }, 3000)
  } catch (err: any) {
    error.value = err.response?.data?.error || err.message || 'Transmission error: Failed to reset access.'
  } finally {
    submitting.value = false
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
          <h2 class="mb-2">Initialize New Credentials</h2>
          <p v-if="!message" class="text-sm text-muted">Complete the identity recovery process.</p>
        </div>

        <div v-if="loading" class="loading-overlay">
          <div class="spinner"></div>
        </div>

        <div v-else>
          <transition name="fade">
            <div v-if="error" class="error-message">
              <span style="margin-right: 8px;">⚠️</span> {{ error }}
            </div>
          </transition>
          
          <transition name="fade">
            <div v-if="message" class="success-message">
              <span style="margin-right: 8px;">✅</span> {{ message }}
            </div>
          </transition>

          <form @submit.prevent="handleSubmit" v-if="isTokenValid && !message">
            <div class="form-group">
              <label class="form-label" for="newPassword">New Secure Password</label>
              <input 
                id="newPassword"
                v-model="newPassword"
                type="password"
                class="form-input"
                required
                minlength="8"
                placeholder="••••••••"
              />
            </div>
            
            <div class="form-group">
              <label class="form-label" for="confirmPassword">Verification</label>
              <input 
                id="confirmPassword"
                v-model="confirmPassword"
                type="password"
                class="form-input"
                required
                minlength="8"
                placeholder="Repeat new password"
              />
            </div>
            
            <button 
              type="submit" 
              class="btn btn-primary btn-glow" 
              style="width: 100%; margin-top: var(--space-4); height: 48px;"
              :disabled="submitting"
            >
              <span v-if="submitting" class="spinner" style="width: 18px; height: 18px; border-width: 2px; margin-right: 8px;"></span>
              {{ submitting ? 'Updating Access...' : 'Reset Secret' }}
            </button>
          </form>
          
          <div v-if="!isTokenValid && !loading" class="text-center mt-10">
            <router-link to="/forgot-password" class="text-sm" style="color: var(--primary-600); text-decoration: none; font-weight: 800;">
              Request New Recovery Link
            </router-link>
          </div>
          <div v-else class="text-center mt-10">
            <router-link to="/login" class="text-sm text-muted" style="text-decoration: none; font-weight: 500;">
              &larr; Abort and Return to Portal
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
