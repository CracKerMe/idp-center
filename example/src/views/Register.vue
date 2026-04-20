<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const username = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value = ''
  success.value = ''
  
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match. Please verify.'
    return
  }
  
  if (password.value.length < 8) {
    error.value = 'Security requirement: Password must be at least 8 characters.'
    return
  }
  
  loading.value = true
  
  try {
    await authStore.register(username.value, email.value, password.value)
    success.value = 'Identity created successfully! Synchronizing access...'
    
    setTimeout(() => {
      router.push('/login')
    }, 2000)
  } catch (err: any) {
    error.value = err.message
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
             <span style="font-size: 2rem;">✨</span> IDP Center
          </div>
          <h2 class="mb-2">Create Identity</h2>
          <p class="text-sm text-muted">Join the world's most secure identity ecosystem.</p>
        </div>
        
        <form @submit.prevent="handleSubmit">
          <transition name="fade">
            <div v-if="error" class="error-message">
              {{ error }}
            </div>
          </transition>
          
          <transition name="fade">
            <div v-if="success" class="success-message">
              {{ success }}
            </div>
          </transition>
          
          <div class="grid grid-2" style="gap: var(--space-4);">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input
                v-model="username"
                type="text"
                class="form-input"
                required
                placeholder="Unique ID"
              />
            </div>
            
            <div class="form-group">
              <label class="form-label">Email</label>
              <input
                v-model="email"
                type="email"
                class="form-input"
                required
                placeholder="your@nexus.com"
              />
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Password</label>
            <input
              v-model="password"
              type="password"
              class="form-input"
              required
              placeholder="Minimum 8 characters"
            />
          </div>
          
          <div class="form-group">
            <label class="form-label">Confirm Password</label>
            <input
              v-model="confirmPassword"
              type="password"
              class="form-input"
              required
              placeholder="Repeat your secret"
            />
          </div>
          
          <button
            type="submit"
            class="btn btn-primary btn-glow"
            style="width: 100%; margin-top: var(--space-4); height: 48px;"
            :disabled="loading"
          >
            <span v-if="loading" class="spinner" style="width: 18px; height: 18px; border-width: 2px; margin-right: 8px;"></span>
            {{ loading ? 'Provisioning...' : 'Initialize Account' }}
          </button>
        </form>
        
        <div class="text-center mt-10">
          <p class="text-sm">
            Already registered?
            <router-link to="/login" style="color: var(--primary-600); text-decoration: none; font-weight: 800;">
              Access Account
            </router-link>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
