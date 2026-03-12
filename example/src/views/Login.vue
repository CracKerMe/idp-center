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

async function handleSubmit() {
  error.value = ''
  loading.value = true
  
  try {
    const success = await authStore.login(username.value, password.value, otp.value || undefined)
    
    if (success) {
      console.log('Login successful, redirecting...')
      const redirect = route.query.redirect as string
      await router.push(redirect || '/dashboard')
    }
  } catch (err: any) {
    console.error('Login error:', err)
    if (err.message === 'OTP_REQUIRED') {
      requireOtp.value = true
      error.value = 'Please enter your authenticator code'
    } else {
      error.value = err.message
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div style="max-width: 400px; margin: 3rem auto;">
    <div class="card">
      <h2 style="font-size: 1.875rem; font-weight: 700; text-align: center; margin-bottom: 2rem;">
        Sign In
      </h2>
      
      <form @submit.prevent="handleSubmit">
        <div v-if="error" class="error-message" style="margin-bottom: 1rem; text-align: center;">
          {{ error }}
        </div>
        
        <div class="form-group">
          <label class="form-label">Username</label>
          <input
            v-model="username"
            type="text"
            class="form-input"
            required
            placeholder="Enter your username"
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">Password</label>
          <input
            v-model="password"
            type="password"
            class="form-input"
            required
            placeholder="Enter your password"
          />
        </div>
        
        <div v-if="requireOtp" class="form-group">
          <label class="form-label">Authenticator Code (OTP)</label>
          <input
            v-model="otp"
            type="text"
            class="form-input"
            required
            placeholder="6-digit code"
            maxlength="6"
          />
        </div>
        
        <button
          type="submit"
          class="btn btn-primary"
          style="width: 100%; margin-top: 1rem;"
          :disabled="loading"
        >
          {{ loading ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>
      
      <div style="margin-top: 1.5rem; text-align: center; color: #6b7280;">
        <p style="margin-bottom: 0.5rem;">
          Don't have an account?
          <router-link to="/register" style="color: #4f46e5; text-decoration: none;">
            Register
          </router-link>
        </p>
        <p style="font-size: 0.875rem;">
          Default: admin / admin123
        </p>
      </div>
    </div>
  </div>
</template>
