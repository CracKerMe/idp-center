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
    <router-link to="/" class="header-link-logo">
      <div class="logo-box">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <span class="logo-text">IDP <span class="text-primary-gradient">Center</span></span>
    </router-link>

    <nav class="header-nav">
      <router-link to="/" class="header-link">Home</router-link>
      <router-link to="/about" class="header-link">About</router-link>
      
      <template v-if="isAuthenticated">
        <router-link to="/dashboard" class="header-link">Dashboard</router-link>
        
        <div class="user-control-group">
          <div class="user-avatar-mini">{{ user?.username?.[0]?.toUpperCase() }}</div>
          <div class="user-dropdown-placeholder">
             <span class="username">{{ user?.username }}</span>
             <button @click="handleLogout" class="btn-logout" title="Revoke Session">
               Sign Out
             </button>
          </div>
        </div>
      </template>
      
      <template v-else>
        <router-link to="/login" class="header-link">Sign In</router-link>
        <router-link to="/register" class="btn btn-primary btn-sm">
          Get Started
        </router-link>
      </template>
    </nav>
  </header>
</template>

<style scoped>
.header-link-logo {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  text-decoration: none;
  transition: opacity 0.2s;
}

.header-link-logo:hover { opacity: 0.8; }

.logo-box {
  background: var(--primary-600);
  width: 40px;
  height: 40px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
}

.logo-text {
  font-weight: 900;
  font-size: 1.25rem;
  color: var(--slate-900);
  letter-spacing: -0.04em;
}

.text-primary-gradient {
  background: linear-gradient(135deg, var(--primary-600) 0%, var(--primary-400) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.user-control-group {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: var(--space-4);
  padding-left: var(--space-4);
  border-left: 1px solid var(--slate-100);
}

.user-avatar-mini {
  width: 32px;
  height: 32px;
  background: var(--slate-100);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 900;
  color: var(--primary-700);
  border: 2px solid white;
  box-shadow: var(--shadow-sm);
}

.user-dropdown-placeholder {
  display: flex;
  flex-direction: column;
}

.username {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--slate-900);
  line-height: 1.2;
}

.btn-logout {
  background: none;
  border: none;
  color: var(--error);
  font-size: 0.65rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0;
  cursor: pointer;
  text-align: left;
  transition: opacity 0.2s;
}

.btn-logout:hover { opacity: 0.7; }

.btn-sm {
  padding: 0.5rem 1rem;
  font-size: 0.75rem;
}

@media (max-width: 768px) {
  .user-control-group { display: none; }
  .header-link-logo span { display: none; }
}
</style>
