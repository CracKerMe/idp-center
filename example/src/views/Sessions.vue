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

const authStore = useAuthStore()
const sessions = ref<Session[]>([])
const loading = ref(false)
const error = ref('')
const currentSessionId = localStorage.getItem('session_id')

async function loadSessions() {
  loading.value = true
  error.value = ''
  
  try {
    sessions.value = await authStore.getSessions()
  } catch (err: any) {
    error.value = 'Failed to load sessions'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function handleRevoke(sessionId: string) {
  if (!confirm('Are you sure you want to revoke this session?')) {
    return
  }
  
  try {
    await authStore.revokeSession(sessionId)
    sessions.value = sessions.value.filter(s => s.id !== sessionId)
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Failed to revoke session'
  }
}

function isCurrentSession(sessionId: string) {
  return sessionId === currentSessionId
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString()
}

onMounted(() => {
  loadSessions()
})
</script>

<template>
  <div style="max-width: 900px; margin: 3rem auto;">
    <div class="card">
      <div style="margin-bottom: 2rem;">
        <h2 style="font-size: 1.875rem; font-weight: 700; margin-bottom: 0.5rem;">
          Active Sessions
        </h2>
        <p style="color: #6b7280;">
          Manage your active sessions across all devices. You can remotely revoke sessions you don't recognize.
        </p>
      </div>

      <div v-if="error" class="error-message" style="margin-bottom: 1rem;">
        {{ error }}
      </div>

      <div v-if="loading" style="text-align: center; padding: 2rem;">
        <p style="color: #6b7280;">Loading sessions...</p>
      </div>

      <div v-else-if="sessions.length === 0" style="text-align: center; padding: 2rem;">
        <p style="color: #6b7280;">No active sessions found</p>
      </div>

      <div v-else class="sessions-list">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="session-item"
          :class="{ 'current-session': isCurrentSession(session.id) }"
        >
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
              <h3 style="font-weight: 600; margin: 0;">
                {{ session.device_info || 'Unknown Device' }}
              </h3>
              <span
                v-if="isCurrentSession(session.id)"
                class="current-badge"
              >
                Current Session
              </span>
            </div>
            
            <div style="font-size: 0.875rem; color: #6b7280;">
              <p style="margin: 0.25rem 0;">
                <strong>IP Address:</strong> {{ session.ip_address }}
              </p>
              <p style="margin: 0.25rem 0;">
                <strong>Last Active:</strong> {{ formatDate(session.last_active) }}
              </p>
              <p style="margin: 0.25rem 0;">
                <strong>Created:</strong> {{ formatDate(session.created_at) }}
              </p>
              <p v-if="session.active_tokens" style="margin: 0.25rem 0;">
                <strong>Active Tokens:</strong> {{ session.active_tokens }}
              </p>
            </div>
          </div>

          <div>
            <button
              v-if="!isCurrentSession(session.id)"
              @click="handleRevoke(session.id)"
              class="btn btn-danger"
              style="font-size: 0.875rem;"
            >
              Revoke Session
            </button>
            <span
              v-else
              style="font-size: 0.875rem; color: #6b7280;"
            >
              This device
            </span>
          </div>
        </div>
      </div>

      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <button
          @click="loadSessions"
          class="btn btn-secondary"
          :disabled="loading"
        >
          {{ loading ? 'Refreshing...' : 'Refresh List' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sessions-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.session-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: white;
  transition: all 0.2s;
}

.session-item:hover {
  border-color: #d1d5db;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.session-item.current-session {
  border-color: #4f46e5;
  background: #f5f3ff;
}

.current-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #4f46e5;
  background: #e0e7ff;
  border-radius: 9999px;
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
}

.btn-secondary {
  background: #6b7280;
  color: white;
}

.btn-secondary:hover {
  background: #4b5563;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
