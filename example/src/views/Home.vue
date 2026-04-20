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
    description: 'Login directly with our secure authentication system. Supports multi-factor authentication (MFA) via TOTP.',
    action: 'Access Account',
    icon: '🔑',
    link: '/login'
  },
  {
    title: 'OAuth2 / OIDC',
    description: 'Industry standard identity layer on top of OAuth 2.0. Securely integrate third-party applications.',
    action: 'Start Authorization',
    icon: '🔐',
    actionFn: () => startOAuthFlow()
  },
  {
    title: 'Self-Service Registration',
    description: 'Quickly set up your identity and manage your security preferences from our intuitive portal.',
    action: 'Create Account',
    icon: '📝',
    link: '/register'
  }
]

function safeReturnTo(returnTo: string | undefined, fallback = '/dashboard') {
  if (!returnTo) return fallback
  if (!returnTo.startsWith('/')) return fallback
  if (returnTo.startsWith('//')) return fallback
  if (returnTo.includes('://')) return fallback
  return returnTo
}

function generateNonce() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function generatePKCE() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const verifier = btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const challenge = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(hash))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return { verifier, challenge }
}

async function startOAuthFlow(returnTo?: string) {
  const clientId = 'default-client'
  const redirectUri = 'http://localhost:3000/callback'
  const nonce = generateNonce()
  const resolvedReturnTo = safeReturnTo(returnTo ?? router.currentRoute.value.fullPath)
  const { verifier, challenge } = await generatePKCE()

  sessionStorage.setItem(
    `oauth_state:${nonce}`,
    JSON.stringify({ nonce, return_to: resolvedReturnTo, verifier, iat: Date.now() })
  )

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    state: nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })

  window.location.href = `http://localhost:5986/#/authorize?${params.toString()}`
}

function goToDashboard() {
  router.push('/dashboard')
}
</script>

<template>
  <div class="home-page">
    <!-- Hero Section -->
    <section class="hero-container mb-12">
      <div class="hero-mesh"></div>
      <div class="hero-content">
        <div class="hero-badge mb-6">
          <span class="badge-dot"></span>
          AI-Native Identity Hub
        </div>
        <h1 class="hero-title mb-6">Secure Your <span class="text-gradient">Digital Universe</span></h1>
        <p class="hero-subtitle mb-8">
          The ultimate identity provider architecture. Modular, developer-first, and built for the modern internet era.
        </p>
        
        <div class="hero-actions">
          <div v-if="isAuthenticated">
            <button @click="goToDashboard" class="btn btn-primary btn-glow-hero">
              Enter Dashboard &rarr;
            </button>
          </div>
          <router-link v-else to="/login" class="btn btn-primary btn-glow-hero">
            Get Started Free
          </router-link>
          <router-link to="/about" class="btn glass-btn-hero">
            Learn More
          </router-link>
        </div>
        
        <div v-if="isAuthenticated" class="mt-8">
          <span class="badge badge-success" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #34d399;">
            Logged in as <strong style="margin-left: 4px;">{{ authStore.user?.username }}</strong>
          </span>
        </div>
      </div>
    </section>

    <!-- Features Grid -->
    <section class="mb-12">
      <div class="text-center mb-16">
        <span class="section-badge mb-4">Core Services</span>
        <h2>Built for Scale and Security</h2>
      </div>
      <div class="grid grid-3">
        <div v-for="feature in features" :key="feature.title" class="premium-card feature-tile">
          <div class="tile-icon mb-6">{{ feature.icon }}</div>
          <h3 class="mb-3" style="font-size: 1.25rem;">{{ feature.title }}</h3>
          <p class="text-sm text-muted mb-8" style="flex: 1; line-height: 1.7;">
            {{ feature.description }}
          </p>
          <router-link 
            v-if="feature.link" 
            :to="feature.link" 
            class="btn btn-secondary" 
            style="width: 100%; border-radius: var(--radius-lg);"
          >
            {{ feature.action }}
          </router-link>
          <button 
            v-else 
            @click="feature.actionFn" 
            class="btn btn-secondary"
            style="width: 100%; border-radius: var(--radius-lg);"
          >
            {{ feature.action }}
          </button>
        </div>
      </div>
    </section>

    <!-- API Reference -->
    <section>
      <div class="premium-card glass-v2" style="padding: var(--space-10);">
        <div class="section-header">
          <div>
            <h2 class="mb-2">Developer Resources</h2>
            <p class="text-muted" style="margin-bottom: 0;">Standardized endpoints for seamless integration.</p>
          </div>
          <div class="api-status">
            <span class="badge-dot" style="background: var(--success); box-shadow: 0 0 10px var(--success);"></span>
            <span class="text-xs font-bold" style="text-transform: uppercase; letter-spacing: 0.1em; color: var(--success);">System Online</span>
          </div>
        </div>
        
        <div class="grid grid-2 mt-8">
          <div v-for="endpoint in [
            { method: 'POST', path: '/api/auth/login', desc: 'Secure credential verification' },
            { method: 'POST', path: '/api/auth/register', desc: 'User provisioning with policies' },
            { method: 'GET', path: '/api/auth/me', desc: 'Context-aware profile retrieval' },
            { method: 'GET', path: '/api/oidc/authorize', desc: 'Standardized OIDC implicit/code flow' },
            { method: 'POST', path: '/api/oidc/token', desc: 'Secure token exchange & PKCE' },
            { method: 'GET', path: '/api/oidc/userinfo', desc: 'Attribute-based identity claims' }
          ]" :key="endpoint.path" class="endpoint-card">
            <div class="endpoint-header mb-2">
              <span class="method-badge" :class="endpoint.method.toLowerCase()">{{ endpoint.method }}</span>
              <code class="endpoint-path">{{ endpoint.path }}</code>
            </div>
            <p class="text-xs text-muted mb-0">
              {{ endpoint.desc }}
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
}

/* --- Hero Section --- */
.hero-container {
  position: relative;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  padding: var(--space-20) var(--space-8);
  min-height: 500px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  background-color: #020617;
  box-shadow: var(--shadow-2xl);
}

.hero-mesh {
  position: absolute;
  inset: 0;
  background-image: 
    radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), 
    radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), 
    radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%);
  filter: blur(80px);
  opacity: 0.5;
}

.hero-content { position: relative; z-index: 10; max-width: 800px; }

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.6rem 1.2rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: var(--primary-200);
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  backdrop-filter: blur(12px);
}

.badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--success);
  box-shadow: 0 0 10px var(--success);
}

.hero-title {
  font-size: clamp(2.5rem, 8vw, 4rem);
  line-height: 1.1;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: white;
}

.hero-subtitle {
  font-size: 1.125rem;
  color: var(--slate-400);
  max-width: 600px;
  margin: 0 auto var(--space-10);
  line-height: 1.6;
}

.hero-actions { display: flex; gap: var(--space-4); justify-content: center; }

.btn-glow-hero {
  box-shadow: 0 0 30px rgba(79, 70, 229, 0.4);
}

.glass-btn-hero {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  backdrop-filter: blur(10px);
}

.feature-tile {
  display: flex;
  flex-direction: column;
}

.tile-icon {
  font-size: 2.5rem;
  background: var(--slate-50);
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xl);
}

.endpoint-card {
  padding: var(--space-5);
  background: white;
  border-radius: var(--radius-xl);
  border: 1px solid var(--slate-100);
  transition: all 0.3s ease;
}

.endpoint-card:hover {
  background: var(--slate-50);
  transform: translateX(4px);
}

.endpoint-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.method-badge {
  font-family: monospace;
  font-size: 0.7rem;
  font-weight: 900;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
}

.method-badge.get { background: #d1fae5; color: #065f46; }
.method-badge.post { background: #e0e7ff; color: #4338ca; }

.endpoint-path {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--slate-800);
}

.api-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

@media (max-width: 768px) {
  .hero-container { padding: var(--space-16) var(--space-6); min-height: auto; }
  .hero-actions { flex-direction: column; }
}
</style>
