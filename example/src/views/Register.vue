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
    error.value = 'Passwords do not match'
    return
  }
  
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters'
    return
  }
  
  loading.value = true
  
  try {
    await authStore.register(username.value, email.value, password.value)
    success.value = 'Registration successful! You can now login.'
    
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
  <div style="max-width: 400px; margin: 3rem auto;">
    <div class="card">
      <h2 style="font-size: 1.875rem; font-weight: 700; text-align: center; margin-bottom: 2rem;">
        Create Account
      </h2>
      
      <form @submit.prevent="handleSubmit">
        <div v-if="error" class="error-message" style="margin-bottom: 1rem;">
          {{ error }}
        </div>
        
        <div v-if="success" class="success-message" style="margin-bottom: 1rem;">
          {{ success }}
        </div>
        
        <div class="form-group">
          <label class="form-label">Username</label>
          <input
            v-model="username"
            type="text"
            class="form-input"
            required
            placeholder="Choose a username"
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">Email</label>
          <input
            v-model="email"
            type="email"
            class="form-input"
            required
            placeholder="your@email.com"
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">Password</label>
          <input
            v-model="password"
            type="password"
            class="form-input"
            required
            placeholder="At least 8 characters"
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input
            v-model="confirmPassword"
            type="password"
            class="form-input"
            required
            placeholder="Confirm your password"
          />
        </div>
        
        <button
          type="submit"
          class="btn btn-primary"
          style="width: 100%; margin-top: 1rem;"
          :disabled="loading"
        >
          {{ loading ? 'Creating Account...' : 'Register' }}
        </button>
      </form>
      
      <div style="margin-top: 1.5rem; text-align: center; color: #6b7280;">
        Already have an account?
        <router-link to="/login" style="color: #4f46e5; text-decoration: none;">
          Sign in
        </router-link>
      </div>
    </div>
  </div>
</template>
