<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const error = ref('')
const loading = ref(true)

function safeReturnTo(returnTo: string | undefined, fallback = '/dashboard') {
  if (!returnTo) return fallback
  if (!returnTo.startsWith('/')) return fallback
  if (returnTo.startsWith('//')) return fallback
  if (returnTo.includes('://')) return fallback
  return returnTo
}

onMounted(async () => {
  const code = route.query.code as string
  const nonce = route.query.state as string
  const errorParam = route.query.error as string

  // Check for OAuth errors
  if (errorParam) {
    error.value = (route.query.error_description as string) || errorParam
    loading.value = false
    return
  }

  if (!nonce) {
    error.value = 'Missing state parameter'
    loading.value = false
    return
  }

  const storageKey = `oauth_state:${nonce}`
  const saved = sessionStorage.getItem(storageKey)
  sessionStorage.removeItem(storageKey)

  if (!saved) {
    error.value = 'Invalid or expired state parameter.'
    loading.value = false
    return
  }

  let record: { nonce: string; return_to?: string; iat: number } | null = null
  try {
    record = JSON.parse(saved)
  } catch {
    error.value = 'Invalid or expired state parameter.'
    loading.value = false
    return
  }

  const ttlMs = 10 * 60 * 1000
  if (!record || record.nonce !== nonce || Date.now() - record.iat > ttlMs) {
    error.value = 'Invalid or expired state parameter.'
    loading.value = false
    return
  }

  // Exchange code for token
  if (!code) {
    error.value = 'No authorization code received'
    loading.value = false
    return
  }

  try {
    // OAuth2 client configuration
    const clientId = 'default-client'
    const clientSecret = 'secret123'
    const redirectUri = 'http://localhost:3000/callback'

    await authStore.exchangeCodeForToken(code, clientId, clientSecret, redirectUri)

    router.replace(safeReturnTo(record.return_to))
  } catch (err: any) {
    console.error('OAuth callback error:', err)
    error.value = err.message || 'Failed to exchange authorization code'
    loading.value = false
  }
})
</script>

<template>
  <div style="max-width: 500px; margin: 3rem auto;">
    <div class="card" style="text-align: center;">
      <div v-if="loading" class="loading">
        <div class="spinner"></div>
      </div>
      
      <template v-else>
        <div v-if="error" class="error-message" style="font-size: 1rem;">
          <svg style="width: 48px; height: 48px; margin-bottom: 1rem;" fill="none" stroke="#dc2626" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p style="color: #dc2626;">{{ error }}</p>
        </div>
        
        <button @click="router.push('/')" class="btn btn-primary" style="margin-top: 1.5rem;">
          Back to Home
        </button>
      </template>
      
      <div v-if="loading">
        <p style="color: #6b7280; margin-top: 1rem;">Processing OAuth callback...</p>
      </div>
    </div>
  </div>
</template>
