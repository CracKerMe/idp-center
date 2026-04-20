<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from './stores/auth'
import AppHeader from './components/AppHeader.vue'

const authStore = useAuthStore()

onMounted(async () => {
  console.log('App mounted, checking auth...')
  console.log('Token in localStorage:', localStorage.getItem('token'))
  console.log('Token in store:', authStore.token)
  
  // 检查是否有 token，如果有则验证并获取用户信息
  if (authStore.token) {
    try {
      console.log('Token found, checking auth...')
      await authStore.checkAuth()
      console.log('Auth check completed')
      console.log('User after check:', authStore.user)
    } catch (error) {
      console.error('Failed to check auth:', error)
    }
  } else {
    authStore.isInitialized = true
  }
})
</script>

<template>
  <div id="app">
    <AppHeader />
    <main v-if="authStore.isInitialized" class="page-container" style="padding-bottom: var(--space-20);">
      <router-view />
    </main>
    <div v-else class="loading-overlay">
      <div class="spinner"></div>
    </div>

    <!-- Global Footer -->
    <footer class="global-footer">
      <div class="footer-grid">
        <div class="footer-brand">
          <div class="footer-logo mb-4">IDP Center</div>
          <p class="text-xs text-muted" style="max-width: 240px; line-height: 1.6;">
            The world's most advanced AI-native identity provider. <br/>Built with security at its core.
          </p>
        </div>
        <div class="footer-links">
          <div class="footer-column">
            <h6>Product</h6>
            <router-link to="/">Features</router-link>
            <router-link to="/about">About</router-link>
            <a href="#">Roadmap</a>
          </div>
          <div class="footer-column">
            <h6>Resources</h6>
            <a href="#">Documentation</a>
            <a href="#">Security Audit</a>
            <a href="#">Status</a>
          </div>
          <div class="footer-column">
            <h6>Legal</h6>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Compliance</a>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <div class="copyright">© {{ new Date().getFullYear() }} IDP Center. All rights reserved.</div>
        <div class="social-links">
          <a href="#" aria-label="Twitter">𝕏</a>
          <a href="#" aria-label="GitHub">GitHub</a>
          <a href="#" aria-label="Discord">Discord</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<style>
#app {
  min-height: 100vh;
  background: var(--slate-50);
  display: flex;
  flex-direction: column;
}

main {
  flex: 1;
}

.global-footer {
  background: #020617;
  color: white;
  padding: var(--space-20) 0 var(--space-10);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  position: relative;
  overflow: hidden;
}

.global-footer::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 1200px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.3), transparent);
}

.footer-grid {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--space-8);
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-12);
  position: relative;
  z-index: 10;
}

.footer-logo {
  font-size: 1.75rem;
  font-weight: 900;
  letter-spacing: -0.04em;
  background: linear-gradient(135deg, #a5b4fc 0%, #fbcfe8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.footer-links {
  display: flex;
  gap: var(--space-20);
}

.footer-column h6 {
  color: white;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: var(--space-8);
  opacity: 0.5;
}

.footer-column a {
  display: block;
  color: var(--slate-400);
  font-size: 0.875rem;
  text-decoration: none;
  margin-bottom: var(--space-4);
  transition: all 0.2s;
}

.footer-column a:hover {
  color: white;
  transform: translateX(4px);
}

.footer-bottom {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-10) var(--space-8) 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  color: var(--slate-500);
  position: relative;
  z-index: 10;
}

.social-links {
  display: flex;
  gap: var(--space-8);
}

.social-links a {
  color: var(--slate-400);
  text-decoration: none;
  transition: color 0.2s;
}

.social-links a:hover {
  color: white;
}

@media (max-width: 1024px) {
  .footer-links { gap: var(--space-12); }
}

@media (max-width: 768px) {
  .global-footer { padding: var(--space-12) 0 var(--space-8); }
  .footer-grid { flex-direction: column; gap: var(--space-12); }
  .footer-links { flex-direction: column; gap: var(--space-12); }
  .footer-bottom { flex-direction: column-reverse; gap: var(--space-8); text-align: center; }
}
</style>
