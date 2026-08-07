<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'

// OIDC front-channel logout receiver (registered as this client's frontchannel_logout_uri,
// see server/database.ts). 5986's end_session/confirm loads this in a hidden iframe when the
// user signs out somewhere else while this app was part of the same SSO browser session — so
// this just clears local state, no navigation, no user-visible UI.
const authStore = useAuthStore()

onMounted(() => {
  authStore.user = null
  authStore.token = null
  localStorage.removeItem('token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('session_id')
  localStorage.removeItem('id_token')
})
</script>

<template>
  <div></div>
</template>
