<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'

interface Session {
  id: string
  device_info: string
  ip_address: string
  last_active: string
  created_at: string
  active_tokens?: number
}

interface TrustedDevice {
  id: string
  device_name: string
  ip_address: string
  trusted_at: string
  last_used_at: string | null
}

const authStore = useAuthStore()
const sessions = ref<Session[]>([])
const trustedDevices = ref<TrustedDevice[]>([])
const loading = ref(false)
const error = ref('')
const currentSessionId = localStorage.getItem('session_id')

async function loadData() {
  loading.value = true
  error.value = ''
  
  try {
    const [sessionsData, devicesData] = await Promise.all([
      authStore.getSessions(),
      authStore.getTrustedDevices()
    ]);
    sessions.value = sessionsData;
    trustedDevices.value = devicesData;
  } catch (err: any) {
    error.value = 'Failed to load security assets from cluster.'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function handleRevokeSession(sessionId: string) {
  if (!confirm('Abort session? This will terminate access immediately.')) return
  
  try {
    await authStore.revokeSession(sessionId)
    sessions.value = sessions.value.filter(s => s.id !== sessionId)
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to revoke protocol session.'
  }
}

async function handleRevokeDevice(deviceId: string) {
  if (!confirm('Remove trust seal? 2FA will be required next time.')) return
  
  try {
    await authStore.revokeTrustedDevice(deviceId)
    trustedDevices.value = trustedDevices.value.filter(d => d.id !== deviceId)
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to revoke device trust.'
  }
}

function isCurrentSession(sessionId: string) {
  return sessionId === currentSessionId
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString()
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="section-header mb-12">
      <div>
        <span class="section-badge mb-4">Security Vectors</span>
        <h1>Active Probes & Trust</h1>
        <p class="text-muted">Monitor and manage all concurrent access points to your identity.</p>
      </div>
      <button
        @click="loadData"
        class="btn btn-secondary btn-glow"
        style="height: 44px; padding: 0 20px;"
        :disabled="loading"
      >
        <span v-if="loading" class="spinner-sm" style="margin-right: 8px;"></span>
        {{ loading ? 'Synchronizing...' : 'Refresh Status' }}
      </button>
    </div>

    <transition name="fade">
      <div v-if="error" class="error-message">
        <span style="margin-right: 8px;">⚠️</span> {{ error }}
      </div>
    </transition>

    <div class="grid grid-1" style="gap: var(--space-8);">
      <!-- Sessions Section -->
      <section class="premium-card">
        <div class="flex items-center gap-4 mb-8">
          <span style="font-size: 1.5rem;">📱</span>
          <h3 class="mb-0">Active Infrastructure</h3>
        </div>
        
        <div v-if="loading && sessions.length === 0" class="loading-overlay">
          <div class="spinner"></div>
        </div>

        <div v-else-if="sessions.length === 0" class="empty-state">
          <p class="text-muted">No active sessions detected.</p>
        </div>

        <div v-else class="sessions-list">
          <div
            v-for="session in sessions"
            :key="session.id"
            class="session-row"
            :class="{ 'is-active': isCurrentSession(session.id) }"
          >
            <div class="device-icon-box">
              {{ session.device_info?.toLowerCase().includes('ios') || session.device_info?.toLowerCase().includes('android') ? '📱' : '💻' }}
            </div>
            
            <div class="session-info">
              <div class="device-name-row">
                <h4 class="mb-1">{{ session.device_info || 'Unknown Node' }}</h4>
                <span v-if="isCurrentSession(session.id)" class="session-pill success">Local Host</span>
                <span v-else class="session-pill muted">Remote Asset</span>
              </div>
              
              <div class="session-meta-grid">
                <div class="meta-item">
                  <label>Network IP</label>
                  <span>{{ session.ip_address }}</span>
                </div>
                <div class="meta-item">
                  <label>Synchronization</label>
                  <span>{{ formatDate(session.last_active) }}</span>
                </div>
                <div class="meta-item">
                  <label>Link Origin</label>
                  <span>{{ formatDate(session.created_at) }}</span>
                </div>
              </div>
            </div>

            <div class="session-actions">
              <button
                v-if="!isCurrentSession(session.id)"
                @click="handleRevokeSession(session.id)"
                class="btn btn-revoke"
              >
                Abort Link
              </button>
              <div v-else class="active-indicator">
                <span class="pulse-dot"></span>
                Active Secure
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Trusted Devices Section -->
      <section class="premium-card glass-v2">
        <div class="flex items-center gap-4 mb-2">
           <span style="font-size: 1.5rem;">⭐</span>
           <h3 class="mb-0">Authenticated Clusters</h3>
        </div>
        <p class="text-xs text-muted mb-8 uppercase tracking-widest font-bold">Trusted Nodes bypassing 2FA Handshake</p>
        
        <div v-if="loading && trustedDevices.length === 0" class="loading-overlay">
          <div class="spinner"></div>
        </div>

        <div v-else-if="trustedDevices.length === 0" class="empty-state-dashed">
          <span style="font-size: 1.5rem; margin-bottom: 12px; display: block;">🔍</span>
          <p class="text-xs font-bold text-muted uppercase">No Trusted Seals Detected</p>
        </div>

        <div v-else class="devices-list">
          <div
            v-for="device in trustedDevices"
            :key="device.id"
            class="device-row"
          >
            <div class="device-label">
               <h4 class="mb-0" style="font-size: 0.95rem;">{{ device.device_name || 'Standard Trust Node' }}</h4>
               <p class="text-xs text-muted mb-0">{{ device.ip_address }} • Linked {{ formatDate(device.trusted_at) }}</p>
            </div>
            
            <div class="device-status">
               <span class="text-xs text-muted" style="margin-right: var(--space-6);">Last Signal: {{ device.last_used_at ? formatDate(device.last_used_at) : 'None' }}</span>
               <button
                 @click="handleRevokeDevice(device.id)"
                 class="btn btn-secondary btn-sm"
                 style="color: var(--error); border-color: rgba(239, 68, 68, 0.2);"
               >
                 De-authorize
               </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sessions-list { display: flex; flex-direction: column; gap: var(--space-4); }

.session-row {
  display: flex;
  align-items: center;
  padding: var(--space-6);
  background: var(--slate-50);
  border: 1px solid var(--slate-100);
  border-radius: var(--radius-2xl);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.session-row:hover {
  background: white;
  border-color: var(--primary-100);
  box-shadow: var(--shadow-lg);
  transform: scale(1.01);
}

.session-row.is-active {
  background: white;
  border-color: var(--primary-400);
  box-shadow: 0 10px 40px rgba(99, 102, 241, 0.1);
}

.device-icon-box {
  width: 48px;
  height: 48px;
  background: white;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  margin-right: var(--space-6);
  box-shadow: var(--shadow-sm);
}

.session-info { flex: 1; }

.device-name-row { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }

.session-pill {
  font-size: 0.65rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 999px;
}

.session-pill.success { background: var(--primary-50); color: var(--primary-700); }
.session-pill.muted { background: var(--slate-200); color: var(--slate-500); }

.session-meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); }

.meta-item label { display: block; font-size: 0.65rem; color: var(--slate-400); font-weight: 700; text-transform: uppercase; margin-bottom: 2px; }
.meta-item span { font-size: 0.8rem; color: var(--slate-700); font-weight: 600; }

.active-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--primary-600);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  background: var(--primary-500);
  border-radius: 50%;
  box-shadow: 0 0 10px var(--primary-500);
  animation: pulse-ring 2s infinite;
}

@keyframes pulse-ring {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.5; }
  100% { transform: scale(1); opacity: 1; }
}

.btn-revoke {
  background: transparent;
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.2);
  font-size: 0.75rem;
  padding: 8px 16px;
}

.btn-revoke:hover {
  background: #fef2f2;
  border-color: var(--error);
}

.empty-state { text-align: center; padding: var(--space-12); color: var(--slate-400); }

.empty-state-dashed {
  text-align: center;
  padding: var(--space-12);
  border: 2px dashed var(--slate-100);
  border-radius: var(--radius-2xl);
}

.devices-list { display: flex; flex-direction: column; gap: var(--space-3); }

.device-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4) var(--space-2);
  border-bottom: 1px solid var(--slate-50);
}

.device-row:last-child { border-bottom: none; }

.device-status { display: flex; align-items: center; }

.btn-sm { font-size: 0.7rem; padding: 6px 12px; height: auto; }

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-top-color: var(--primary-600);
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
