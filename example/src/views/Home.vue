<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const isAuthenticated = computed(() => authStore.isAuthenticated)

const features = [
  {
    title: 'Direct Login',
    description: 'Login directly with username and password. Supports OTP two-factor authentication.',
    action: 'Login Now',
    icon: '🔑',
    link: '/login'
  },
  {
    title: 'OAuth2 Authorization Code',
    description: 'Use OAuth2 Authorization Code flow to integrate with IDP Center.',
    action: 'Start OAuth Flow',
    icon: '🔐',
    actionFn: () => startOAuthFlow()
  },
  {
    title: 'User Registration',
    description: 'Create a new account in IDP Center.',
    action: 'Register',
    icon: '📝',
    link: '/register'
  }
]

function startOAuthFlow() {
  // OAuth2 configuration
  const clientId = 'default-client'
  const redirectUri = 'http://localhost:3000/callback'
  
  // Generate random state for CSRF protection
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  
  // Save state for verification
  localStorage.setItem('oauth_state', state)
  
  // Redirect to IDP Center's authorization endpoint
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    state: state
  })
  
  window.location.href = `http://localhost:5986/authorize?${params.toString()}`
}

function goToDashboard() {
  router.push('/dashboard')
}
</script>

<template>
  <div>
    <!-- Hero Section -->
    <div class="card" style="text-align: center; margin-bottom: 2rem;">
      <h1 style="font-size: 2.5rem; font-weight: 700; color: #1f2937; margin-bottom: 1rem;">
        Welcome to IDP Center Demo
      </h1>
      <p style="font-size: 1.125rem; color: #6b7280; margin-bottom: 1.5rem;">
        This demo shows how to integrate your Vue application with IDP Center authentication.
      </p>
      
      <router-link to="/about" class="btn btn-secondary" style="text-decoration: none;">
        Learn More About IDP Center
      </router-link>
      
      <div v-if="isAuthenticated" style="margin-top: 1.5rem;">
        <p style="color: #16a34a; margin-bottom: 1rem;">✓ You are already logged in!</p>
        <button @click="goToDashboard" class="btn btn-primary">
          Go to Dashboard
        </button>
      </div>
    </div>

    <!-- Features Grid -->
    <div class="grid grid-3">
      <div v-for="feature in features" :key="feature.title" class="card">
        <div style="font-size: 2.5rem; margin-bottom: 1rem;">{{ feature.icon }}</div>
        <h3 style="font-size: 1.25rem; font-weight: 600; color: #1f2937; margin-bottom: 0.5rem;">
          {{ feature.title }}
        </h3>
        <p style="color: #6b7280; margin-bottom: 1.5rem; font-size: 0.875rem;">
          {{ feature.description }}
        </p>
        <router-link 
          v-if="feature.link" 
          :to="feature.link" 
          class="btn btn-primary" 
          style="display: block; text-align: center; text-decoration: none;"
        >
          {{ feature.action }}
        </router-link>
        <button 
          v-else 
          @click="feature.actionFn" 
          class="btn btn-primary"
          style="width: 100%;"
        >
          {{ feature.action }}
        </button>
      </div>
    </div>

    <!-- API Endpoints Reference -->
    <div class="card" style="margin-top: 2rem;">
      <h2 style="font-size: 1.5rem; font-weight: 600; color: #1f2937; margin-bottom: 1.5rem;">
        Available API Endpoints
      </h2>
      
      <div style="display: grid; gap: 1rem;">
        <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
          <code style="color: #4f46e5;">POST /api/auth/login</code>
          <p style="color: #6b7280; font-size: 0.875rem; margin-top: 0.5rem;">
            Login with username and password
          </p>
        </div>
        
        <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
          <code style="color: #4f46e5;">POST /api/auth/register</code>
          <p style="color: #6b7280; font-size: 0.875rem; margin-top: 0.5rem;">
            Register a new user
          </p>
        </div>
        
        <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
          <code style="color: #4f46e5;">GET /api/auth/me</code>
          <p style="color: #6b7280; font-size: 0.875rem; margin-top: 0.5rem;">
            Get current user info (requires Bearer token)
          </p>
        </div>
        
        <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
          <code style="color: #4f46e5;">GET /api/oidc/authorize</code>
          <p style="color: #6b7280; font-size: 0.875rem; margin-top: 0.5rem;">
            OAuth2 authorization endpoint
          </p>
        </div>
        
        <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
          <code style="color: #4f46e5;">POST /api/oidc/token</code>
          <p style="color: #6b7280; font-size: 0.875rem; margin-top: 0.5rem;">
            Exchange authorization code for access token
          </p>
        </div>
        
        <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
          <code style="color: #4f46e5;">GET /api/oidc/userinfo</code>
          <p style="color: #6b7280; font-size: 0.875rem; margin-top: 0.5rem;">
            Get user info with access token
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
