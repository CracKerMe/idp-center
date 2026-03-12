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
    <main v-if="authStore.isInitialized" style="padding: 2rem; max-width: 1200px; margin: 0 auto;">
      <router-view />
    </main>
    <div v-else style="display: flex; justify-content: center; align-items: center; min-height: 50vh;">
      <p style="color: #6b7280;">Loading...</p>
    </div>
  </div>
</template>

<style>
#app {
  min-height: 100vh;
  background: #f9fafb;
}
</style>
