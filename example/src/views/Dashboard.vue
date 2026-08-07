<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()
const user = computed(() => authStore.user)

const token = computed(() => {
  const stored = localStorage.getItem('token')
  const fromStore = authStore.token
  return stored || fromStore
})

const tokenPayload = computed(() => {
  const tokenValue = token.value
  if (!tokenValue) return null

  try {
    const parts = tokenValue.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    const decoded = JSON.parse(atob(payload))
    return decoded
  } catch (error) {
    console.error('Failed to decode token:', error)
    return null
  }
})

// --- Token introspection (RFC 7662) / revocation (RFC 7009) ---
// Calls the OAuth /introspect and /revoke endpoints directly with the demo's client
// credentials — only works when VITE_CLIENT_SECRET is configured (see README).
const introspection = ref<any>(null)
const introspecting = ref(false)
const introspectError = ref('')
const revoking = ref(false)

async function runIntrospect() {
  if (!token.value) return
  introspecting.value = true
  introspectError.value = ''
  try {
    introspection.value = await authStore.introspectToken(token.value, 'access_token')
  } catch (err: any) {
    introspectError.value = err.response?.data?.error_description || err.response?.data?.error || 'Introspection failed — is VITE_CLIENT_SECRET configured?'
  } finally {
    introspecting.value = false
  }
}

async function runRevoke() {
  if (!token.value) return
  if (!confirm('Revoke this access token (and its refresh token family) right now?')) return
  revoking.value = true
  try {
    await authStore.revokeToken(token.value, 'access_token')
    const refreshToken = localStorage.getItem('refresh_token')
    if (refreshToken) await authStore.revokeToken(refreshToken, 'refresh_token')
    await authStore.logout()
    router.push('/login')
  } catch (err: any) {
    introspectError.value = err.response?.data?.error_description || err.response?.data?.error || 'Revocation failed'
  } finally {
    revoking.value = false
  }
}
</script>

<template>
  <div class="page-container">
    <div class="section-header mb-12">
      <div>
        <span class="section-badge mb-4">Command Center</span>
        <h1>Identity Overview</h1>
        <p class="text-muted">Real-time status of your global authentication state.</p>
      </div>
      <div class="dashboard-stats">
        <div class="stat-bubble">
          <span class="stat-label">Security Score</span>
          <span class="stat-value" :style="{ color: user?.otp_enabled ? 'var(--success)' : 'var(--warning)' }">
            {{ user?.otp_enabled ? '98%' : '45%' }}
          </span>
        </div>
      </div>
    </div>
    
    <div class="grid grid-2 mb-12">
      <!-- User Profile Card -->
      <div class="premium-card">
        <div class="card-header-icon mb-6">👤</div>
        <h3 class="mb-6">Global Profile</h3>
        
        <div v-if="user" class="info-list">
          <div v-for="item in [
            { label: 'Canonical ID', value: user.id, mono: true, icon: '🆔' },
            { label: 'Identity Handle', value: user.username, weight: 800, icon: '🏷️' },
            { label: 'Primary Contact', value: user.email, icon: '📧' },
            { label: 'Access Level', value: user.is_admin ? 'System Administrator' : 'Authorized User', badge: user.is_admin ? 'success' : 'primary', icon: '🛡️' },
            { label: 'Multi-Factor Status', value: user.otp_enabled ? 'Active' : 'Disabled', badge: user.otp_enabled ? 'success' : 'warning', icon: '🔑' }
          ]" :key="item.label" class="info-item">
            <div class="info-icon">{{ item.icon }}</div>
            <div class="info-content">
              <label class="info-label">{{ item.label }}</label>
              <div class="info-value-row">
                <span :class="{ 'text-mono': item.mono, 'font-bold': item.weight }" :style="{ color: 'var(--slate-900)' }">
                  {{ item.value }}
                </span>
                <span v-if="item.badge" class="badge ml-2" :class="`badge-${item.badge}`">
                  {{ item.value }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Token Diagnostics -->
      <div class="premium-card">
        <div class="card-header-icon mb-6">📑</div>
        <h3 class="mb-6">Session Diagnostics</h3>
        
        <div v-if="tokenPayload" class="info-list">
          <div v-for="item in [
            { label: 'Token Subject', value: tokenPayload.id, mono: true },
            { label: 'Identity Claims', value: tokenPayload.username },
            { label: 'Issue Timestamp', value: new Date(tokenPayload.iat * 1000).toLocaleString() },
            { label: 'Expiration Horizon', value: new Date(tokenPayload.exp * 1000).toLocaleString() }
          ]" :key="item.label" class="simple-info-item">
            <label class="info-label">{{ item.label }}</label>
            <p class="info-value mb-0" :class="{ 'text-mono': item.mono }">{{ item.value }}</p>
          </div>
        </div>
        
        <div class="mt-8">
          <label class="info-label mb-2 block">Live JWT Payload</label>
          <div class="code-terminal">
            <div class="terminal-header">
              <span class="dot red"></span>
              <span class="dot yellow"></span>
              <span class="dot green"></span>
              <span class="terminal-title">bearer_token.jwt</span>
            </div>
            <div class="terminal-body" v-if="token">
              <code>{{ token }}</code>
            </div>
            <div v-else class="terminal-body text-center text-error font-bold">MISSING_CREDENTIALS</div>
          </div>
        </div>

        <!-- RFC 7662 / RFC 7009: introspect and revoke the current access token via /api/oidc -->
        <div class="mt-8">
          <label class="info-label mb-2 block">Token Introspection (RFC 7662)</label>
          <div class="flex gap-3 mb-4">
            <button class="btn btn-secondary btn-sm" :disabled="introspecting" @click="runIntrospect">
              {{ introspecting ? 'Checking...' : 'Introspect Access Token' }}
            </button>
            <button class="btn btn-secondary btn-sm" style="color: var(--error);" :disabled="revoking" @click="runRevoke">
              {{ revoking ? 'Revoking...' : 'Revoke Token (RFC 7009)' }}
            </button>
          </div>
          <div v-if="introspectError" class="error-message mb-4">{{ introspectError }}</div>
          <div v-if="introspection" class="code-terminal">
            <div class="terminal-header">
              <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
              <span class="terminal-title">introspect_response.json</span>
            </div>
            <div class="terminal-body"><code>{{ JSON.stringify(introspection, null, 2) }}</code></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Strategic Actions -->
    <div class="mb-12">
      <div class="text-center mb-10">
        <span class="section-badge mb-4">Tactical Operations</span>
        <h2>Manage Identity Assets</h2>
      </div>
      <div class="grid grid-3">
        <router-link to="/mfa-factors" class="action-card">
          <div class="action-icon">🔒</div>
          <div class="action-text">
            <strong>Security Hardening</strong>
            <p>Manage authenticator apps, security keys, email codes, and recovery codes.</p>
          </div>
          <div class="action-arrow">&rarr;</div>
        </router-link>

        <router-link to="/sessions" class="action-card">
          <div class="action-icon">📱</div>
          <div class="action-text">
            <strong>Active Probes</strong>
            <p>Monitor and terminate concurrent active sessions and trusted devices.</p>
          </div>
          <div class="action-arrow">&rarr;</div>
        </router-link>

        <router-link to="/profile" class="action-card">
          <div class="action-icon">👤</div>
          <div class="action-text">
            <strong>Profile Mutation</strong>
            <p>Modify core identity attributes and credentials.</p>
          </div>
          <div class="action-arrow">&rarr;</div>
        </router-link>

        <router-link to="/device-flow" class="action-card">
          <div class="action-icon">📺</div>
          <div class="action-text">
            <strong>Device Authorization</strong>
            <p>Try the RFC 8628 device code flow, as used by CLIs and TVs.</p>
          </div>
          <div class="action-arrow">&rarr;</div>
        </router-link>
      </div>
    </div>

    <!-- Infrastructure Visualization -->
    <section class="premium-card glass-v2 border-primary">
      <div class="flex items-center gap-6">
        <div class="viz-icon">⚡</div>
        <div>
          <h3 class="mb-2">Unified Identity Architecture</h3>
          <p class="text-sm text-muted mb-6">
            Your identity is secured by the IDP Center's cluster. Standardized OIDC and OAuth2 flows protect every transaction.
          </p>
          <div class="flex gap-3">
            <span class="pill primary">FIPS 140-2</span>
            <span class="pill primary">OIDC 1.0</span>
            <span class="pill primary">AES-256</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dashboard-stats {
  background: white;
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--slate-100);
}

.stat-bubble {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.stat-label { font-size: 0.7rem; font-weight: 800; color: var(--slate-400); text-transform: uppercase; letter-spacing: 0.1em; }
.stat-value { font-size: 1.5rem; font-weight: 900; }

.info-list { display: flex; flex-direction: column; gap: var(--space-4); }

.info-item {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--slate-50);
  border-radius: var(--radius-xl);
  border: 1px solid transparent;
  transition: all 0.3s ease;
}

.info-item:hover {
  background: white;
  border-color: var(--primary-100);
  box-shadow: var(--shadow-md);
  transform: translateX(4px);
}

.info-icon { font-size: 1.5rem; }
.info-content { flex: 1; }
.info-label { font-size: 0.75rem; color: var(--slate-400); font-weight: 700; margin-bottom: 2px; display: block; }
.info-value-row { display: flex; align-items: center; justify-content: space-between; }

.simple-info-item {
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--slate-100);
}

.simple-info-item:last-child { border-bottom: none; }

.info-value { font-size: 0.875rem; color: var(--slate-800); font-weight: 600; }
.text-mono { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; }

.code-terminal {
  background: #0f172a;
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-xl);
}

.terminal-header {
  background: #1e293b;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot { width: 10px; height: 10px; border-radius: 50%; }
.red { background: #ef4444; }
.yellow { background: #f59e0b; }
.green { background: #10b981; }
.terminal-title { font-size: 0.7rem; color: var(--slate-400); font-family: monospace; margin-left: 8px; }

.terminal-body {
  padding: 12px;
  max-height: 120px;
  overflow-y: auto;
}

.terminal-body code {
  color: var(--primary-300);
  font-size: 0.7rem;
  word-break: break-all;
  white-space: pre-wrap;
}

.action-card {
  background: white;
  padding: var(--space-8);
  border-radius: var(--radius-2xl);
  border: 1px solid var(--slate-100);
  text-decoration: none;
  transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  position: relative;
}

.action-card:hover {
  transform: translateY(-8px);
  border-color: var(--primary-300);
  box-shadow: var(--shadow-premium);
}

.action-icon {
  font-size: 2.5rem;
  background: var(--slate-50);
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xl);
}

.action-text strong { display: block; font-size: 1.125rem; color: var(--slate-900); margin-bottom: var(--space-1); }
.action-text p { font-size: 0.875rem; color: var(--slate-500); margin: 0; line-height: 1.5; }

.action-arrow {
  position: absolute;
  bottom: 24px;
  right: 24px;
  font-size: 1.5rem;
  color: var(--primary-500);
  opacity: 0;
  transform: translateX(-10px);
  transition: all 0.3s ease;
}

.action-card:hover .action-arrow {
  opacity: 1;
  transform: translateX(0);
}

.viz-icon {
  font-size: 3rem;
  background: var(--primary-50);
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-2xl);
  color: var(--primary-600);
}

.pill {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pill.primary { background: var(--primary-50); color: var(--primary-700); }
.border-primary { border-color: var(--primary-100); }

@media (max-width: 768px) {
  .section-header { flex-direction: column; align-items: flex-start; gap: var(--space-6); }
  .dashboard-stats { width: 100%; text-align: left; }
  .stat-bubble { align-items: flex-start; }
}

.block { display: block; }
</style>
