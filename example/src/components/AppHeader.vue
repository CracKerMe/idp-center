<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)
const user = computed(() => authStore.user)

function handleLogout() {
  authStore.logout()
  router.push('/')
}
</script>

<template>
  <header class="header">
    <div class="header-logo">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 17L12 22L22 17" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 12L12 17L22 12" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>IDP Center Demo</span>
    </div>

    <nav class="header-nav">
      <router-link to="/" class="header-link">Home</router-link>
      <router-link to="/about" class="header-link">About</router-link>
      
      <template v-if="isAuthenticated">
        <router-link to="/dashboard" class="header-link">Dashboard</router-link>
        <router-link to="/profile" class="header-link">Profile</router-link>
        <router-link to="/sessions" class="header-link">Sessions</router-link>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="color: #6b7280;">{{ user?.username }}</span>
          <button @click="handleLogout" class="btn btn-secondary" style="padding: 0.5rem 1rem;">
            Logout
          </button>
        </div>
      </template>
      
      <template v-else>
        <router-link to="/login" class="header-link">Login</router-link>
        <router-link to="/register" class="btn btn-primary" style="text-decoration: none;">
          Register
        </router-link>
      </template>
    </nav>
  </header>
</template>
