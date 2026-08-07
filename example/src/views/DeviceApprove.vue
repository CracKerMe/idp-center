<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const authStore = useAuthStore()

const userCode = ref((route.query.user_code as string) || '')
const clientName = ref('')
const scope = ref('')
const status = ref<'idle' | 'looking-up' | 'found' | 'not-found' | 'approved' | 'denied'>('idle')
const errorMsg = ref('')

async function lookup() {
  if (!userCode.value.trim()) return
  status.value = 'looking-up'
  errorMsg.value = ''
  try {
    const result = await authStore.deviceVerify(userCode.value.trim())
    clientName.value = result.client_name
    scope.value = result.scope
    status.value = 'found'
  } catch (err: any) {
    status.value = 'not-found'
    errorMsg.value = err.response?.data?.error || 'Invalid or expired code'
  }
}

onMounted(() => {
  if (userCode.value) lookup()
})

async function approve() {
  try {
    await authStore.deviceApprove(userCode.value.trim())
    status.value = 'approved'
  } catch (err: any) {
    errorMsg.value = err.response?.data?.error || 'Failed to approve'
  }
}

async function deny() {
  try {
    await authStore.deviceDeny(userCode.value.trim())
    status.value = 'denied'
  } catch (err: any) {
    errorMsg.value = err.response?.data?.error || 'Failed to deny'
  }
}
</script>

<template>
  <div class="page-container" style="max-width: 480px;">
    <div class="section-header mb-8">
      <div>
        <span class="section-badge mb-4">Device Approval</span>
        <h1>Confirm Sign-In</h1>
        <p class="text-muted">Approving here authorizes the device that showed you this code — make sure the code matches.</p>
      </div>
    </div>

    <section class="premium-card">
      <form v-if="status === 'idle' || status === 'not-found'" @submit.prevent="lookup">
        <div class="form-group">
          <label class="form-label">Code</label>
          <input v-model="userCode" type="text" class="form-input" required placeholder="XXXX-XXXX" autofocus />
        </div>
        <div v-if="errorMsg" class="error-message mb-4">{{ errorMsg }}</div>
        <button type="submit" class="btn btn-primary" style="width: 100%; height: 44px;">Continue</button>
      </form>

      <div v-else-if="status === 'looking-up'" class="text-center"><div class="spinner"></div></div>

      <div v-else-if="status === 'found'" class="text-center">
        <p class="text-sm text-muted mb-2">Application requesting access</p>
        <h3 class="mb-4">{{ clientName }}</h3>
        <p class="text-xs text-muted mb-8">Requested scope: <code>{{ scope }}</code></p>
        <div style="display: flex; gap: var(--space-3);">
          <button class="btn btn-secondary" style="flex: 1; height: 44px;" @click="deny">Deny</button>
          <button class="btn btn-primary" style="flex: 1; height: 44px;" @click="approve">Approve</button>
        </div>
      </div>

      <div v-else-if="status === 'approved'" class="text-center">
        <p class="text-2xl mb-4">✅</p>
        <p class="text-muted">Device approved. You can return to it now.</p>
      </div>

      <div v-else-if="status === 'denied'" class="text-center">
        <p class="text-2xl mb-4">🚫</p>
        <p class="text-muted">Request denied.</p>
      </div>
    </section>
  </div>
</template>
