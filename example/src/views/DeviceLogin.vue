<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const status = ref<'idle' | 'waiting' | 'approved' | 'denied' | 'expired' | 'error'>('idle')
const userCode = ref('')
const verificationUri = ref('')
const errorMsg = ref('')
let pollTimer: ReturnType<typeof setTimeout> | null = null

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

onBeforeUnmount(stopPolling)

async function start() {
  status.value = 'idle'
  errorMsg.value = ''
  try {
    const auth = await authStore.startDeviceAuthorization()
    userCode.value = auth.user_code
    verificationUri.value = auth.verification_uri_complete
    status.value = 'waiting'
    poll(auth.device_code, auth.interval * 1000, Date.now() + auth.expires_in * 1000)
  } catch (err: any) {
    status.value = 'error'
    errorMsg.value = err.response?.data?.error_description || err.response?.data?.error || 'Failed to start device authorization'
  }
}

function poll(deviceCode: string, intervalMs: number, deadline: number) {
  pollTimer = setTimeout(async () => {
    if (Date.now() > deadline) {
      status.value = 'expired'
      return
    }
    try {
      const result = await authStore.pollDeviceToken(deviceCode)
      if (result.status === 'approved') {
        status.value = 'approved'
        return
      }
      if (result.status === 'denied') {
        status.value = 'denied'
        return
      }
      if (result.status === 'expired') {
        status.value = 'expired'
        return
      }
      // 'pending' or 'slow_down' — keep polling, backing off if told to.
      poll(deviceCode, result.status === 'slow_down' ? intervalMs + 5000 : intervalMs, deadline)
    } catch (err: any) {
      status.value = 'error'
      errorMsg.value = err.response?.data?.error || 'Device polling failed'
    }
  }, intervalMs)
}

function goToDashboard() {
  router.push('/dashboard')
}
</script>

<template>
  <div class="page-container" style="max-width: 560px;">
    <div class="section-header mb-8">
      <div>
        <span class="section-badge mb-4">RFC 8628</span>
        <h1>Device Authorization Grant</h1>
        <p class="text-muted">Simulates a "device" client (CLI, TV, IoT) that has no browser of its own — it just displays a code and waits.</p>
      </div>
    </div>

    <section class="premium-card">
      <div v-if="status === 'idle'" class="text-center">
        <p class="text-sm text-muted mb-6">Click below to request a device code from the IDP Center.</p>
        <button class="btn btn-primary btn-glow" style="height: 48px;" @click="start">Start Device Sign-In</button>
      </div>

      <div v-else-if="status === 'waiting'" class="text-center">
        <p class="text-sm text-muted mb-2">On another device, open the verification URL and enter this code:</p>
        <div class="user-code">{{ userCode }}</div>
        <p class="text-xs text-muted mb-6" style="word-break: break-all;">{{ verificationUri }}</p>
        <router-link
          :to="{ path: '/device', query: { user_code: userCode } }"
          class="btn btn-secondary"
          style="width: 100%; height: 44px; margin-bottom: var(--space-3);"
        >
          Open approval page in this demo
        </router-link>
        <div class="flex items-center justify-center gap-3">
          <span class="spinner-sm"></span>
          <span class="text-xs text-muted">Waiting for approval…</span>
        </div>
      </div>

      <div v-else-if="status === 'approved'" class="text-center">
        <p class="text-2xl mb-4">✅</p>
        <p class="mb-6">Device signed in successfully.</p>
        <button class="btn btn-primary" style="width: 100%; height: 44px;" @click="goToDashboard">Go to Dashboard</button>
      </div>

      <div v-else-if="status === 'denied'" class="text-center">
        <p class="text-2xl mb-4">🚫</p>
        <p class="text-muted mb-6">The sign-in request was denied.</p>
        <button class="btn btn-secondary" @click="start">Try Again</button>
      </div>

      <div v-else-if="status === 'expired'" class="text-center">
        <p class="text-2xl mb-4">⏱️</p>
        <p class="text-muted mb-6">The code expired before it was approved.</p>
        <button class="btn btn-secondary" @click="start">Try Again</button>
      </div>

      <div v-else-if="status === 'error'" class="text-center">
        <div class="error-message mb-6">{{ errorMsg }}</div>
        <button class="btn btn-secondary" @click="start">Try Again</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.user-code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: 0.15em;
  background: var(--slate-50);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.spinner-sm {
  width: 14px; height: 14px;
  border: 2px solid rgba(0,0,0,0.1);
  border-top-color: var(--primary-600);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
