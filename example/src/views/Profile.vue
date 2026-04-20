<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import http from '../utils/http'

const authStore = useAuthStore()
const user = computed(() => authStore.user)

const fullName = ref('')
const phone = ref('')
const loading = ref(false)
const message = ref('')
const error = ref('')

onMounted(async () => {
  if (authStore.token) {
    try {
      const response = await http.get('/auth/me')
      if (response.status === 200) {
        const userData = response.data.data ?? response.data
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
    await http.put('/user/profile', {
      full_name: fullName.value,
      phone: phone.value
    })
    await authStore.checkAuth()
    message.value = 'Identity attributes updated successfully!'
  } catch (err: any) {
    error.value = err.response?.data?.error || err.message || 'Failed to commit profile mutations.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page-container" style="max-width: 800px;">
    <div class="section-header mb-12">
      <div>
        <span class="section-badge mb-4">Account Control</span>
        <h1>Identity Profile</h1>
        <p class="text-muted">Manage your core identity attributes and contact information.</p>
      </div>
    </div>
    
    <div class="premium-card glass-v2" style="padding: var(--space-8) var(--space-10);">
      <div class="flex items-center gap-6 mb-10">
        <div class="avatar-glow">
          <div class="avatar-placeholder">{{ user?.username?.[0]?.toUpperCase() }}</div>
        </div>
        <div>
          <h3 class="mb-1">{{ user?.username }}</h3>
          <p class="text-xs text-muted mb-0 uppercase tracking-widest font-bold">Authenticated Subject</p>
        </div>
      </div>
      
      <form @submit.prevent="updateProfile">
        <transition name="fade">
          <div v-if="message" class="success-message">
            <span style="margin-right: 8px;">✅</span> {{ message }}
          </div>
        </transition>
        
        <transition name="fade">
          <div v-if="error" class="error-message">
            <span style="margin-right: 8px;">⚠️</span> {{ error }}
          </div>
        </transition>
        
        <div class="grid grid-2 mb-8">
          <div class="form-group">
            <label class="form-label">System Username</label>
            <div class="input-with-icon disabled">
               <span class="input-icon">🆔</span>
               <input :value="user?.username" type="text" class="form-input" disabled />
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Verified Email</label>
            <div class="input-with-icon disabled">
               <span class="input-icon">📧</span>
               <input :value="user?.email" type="email" class="form-input" disabled />
            </div>
          </div>
        </div>
        
        <div class="form-group mb-6">
          <label class="form-label">Display Name</label>
          <div class="input-with-icon">
             <span class="input-icon">👤</span>
             <input
               v-model="fullName"
               type="text"
               class="form-input"
               placeholder="How should we address you?"
             />
          </div>
        </div>
        
        <div class="form-group mb-10">
          <label class="form-label">Secure Phone Horizon</label>
          <div class="input-with-icon">
             <span class="input-icon">📱</span>
             <input
               v-model="phone"
               type="tel"
               class="form-input"
               placeholder="+1 (555) 000-0000"
             />
          </div>
        </div>
        
        <div class="flex justify-start">
          <button
            type="submit"
            class="btn btn-primary btn-glow"
            style="min-width: 180px; height: 48px;"
            :disabled="loading"
          >
            <span v-if="loading" class="spinner-sm" style="margin-right: 8px;"></span>
            {{ loading ? 'Synchronizing...' : 'Update Identity' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.avatar-glow {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.2);
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--primary-500) 0%, var(--primary-800) 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: 900;
}

.input-with-icon {
  position: relative;
}

.input-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.125rem;
  pointer-events: none;
  opacity: 0.7;
}

.input-with-icon .form-input {
  padding-left: 44px;
}

.input-with-icon.disabled .form-input {
  background: var(--slate-100);
  border-color: var(--slate-200);
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
