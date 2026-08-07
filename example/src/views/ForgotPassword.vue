<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const email = ref('')
const loading = ref(false)
const error = ref('')
const message = ref('')

async function handleSubmit() {
  if (!email.value) return
  
  loading.value = true
  error.value = ''
  message.value = ''
  
  try {
    await authStore.requestPasswordReset(email.value)
    message.value = 'Verification packet sent. If the account exists, you will receive instructions shortly.'
  } catch (err: any) {
    error.value = err.response?.data?.error || err.message || 'Failed to initialize reset sequence.'
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
          <h2 class="mb-2">Identity Recovery</h2>
          <p class="text-sm text-muted">Enter your registered email to reset your access tokens.</p>
        </div>

        <transition name="fade">
          <div v-if="error" class="error-message">
            <span style="margin-right: 8px;">⚠️</span> {{ error }}
          </div>
        </transition>
        
        <transition name="fade">
          <div v-if="message" class="success-message">
            <span style="margin-right: 8px;">📧</span> {{ message }}
          </div>
        </transition>

        <form @submit.prevent="handleSubmit" v-if="!message">
          <div class="form-group">
            <label class="form-label" for="email">Associated Email</label>
            <input 
              id="email"
              v-model="email"
              type="email"
              class="form-input"
              required
              placeholder="you@nexus.com"
              autocomplete="email"
            />
          </div>
          
          <button 
            type="submit" 
            class="btn btn-primary btn-glow" 
            style="width: 100%; margin-top: var(--space-4); height: 48px;"
            :disabled="loading"
          >
            <span v-if="loading" class="spinner" style="width: 18px; height: 18px; border-width: 2px; margin-right: 8px;"></span>
            {{ loading ? 'Initializing...' : 'Request Reset Link' }}
          </button>
        </form>
        
        <div class="text-center mt-10">
          <router-link to="/login" class="text-sm" style="color: var(--primary-600); text-decoration: none; font-weight: 800;">
            &larr; Return to Secure Portal
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
