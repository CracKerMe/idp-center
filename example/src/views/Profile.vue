<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const user = computed(() => authStore.user)

const fullName = ref('')
const phone = ref('')
const loading = ref(false)
const message = ref('')
const error = ref('')

onMounted(async () => {
  // Fetch user profile
  if (authStore.token) {
    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${authStore.token}`
        }
      })
      
      if (response.ok) {
        const userData = await response.json()
        fullName.value = userData.full_name || ''
        phone.value = userData.phone || ''
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err)
    }
  }
})

async function updateProfile() {
  loading.value = true
  error.value = ''
  message.value = ''
  
  try {
    const response = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authStore.token}`
      },
      body: JSON.stringify({
        full_name: fullName.value,
        phone: phone.value
      })
    })
    
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to update profile')
    }
    
    message.value = 'Profile updated successfully!'
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <h1 style="font-size: 2rem; font-weight: 700; margin-bottom: 2rem;">
      Profile Settings
    </h1>
    
    <div class="card" style="max-width: 600px;">
      <h2 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem;">
        Personal Information
      </h2>
      
      <form @submit.prevent="updateProfile">
        <div v-if="message" class="success-message" style="margin-bottom: 1rem;">
          {{ message }}
        </div>
        
        <div v-if="error" class="error-message" style="margin-bottom: 1rem;">
          {{ error }}
        </div>
        
        <div class="form-group">
          <label class="form-label">Username</label>
          <input
            :value="user?.username"
            type="text"
            class="form-input"
            disabled
            style="background: #f3f4f6;"
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">Email</label>
          <input
            :value="user?.email"
            type="email"
            class="form-input"
            disabled
            style="background: #f3f4f6;"
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input
            v-model="fullName"
            type="text"
            class="form-input"
            placeholder="Enter your full name"
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input
            v-model="phone"
            type="tel"
            class="form-input"
            placeholder="Enter your phone number"
          />
        </div>
        
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="loading"
        >
          {{ loading ? 'Saving...' : 'Save Changes' }}
        </button>
      </form>
    </div>
  </div>
</template>
