<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore, type IdpOption } from '../stores/auth'

const emit = defineEmits<{ success: []; error: [message: string] }>()

const authStore = useAuthStore()
const providers = ref<IdpOption[]>([])
const ldapAlias = ref<string | null>(null)
const ldapUsername = ref('')
const ldapPassword = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    providers.value = await authStore.getIdpProviders()
  } catch {
    // No IdPs configured (or admin hasn't set any up yet) — render nothing, same as the
    // main app's SsoProviderButtons.tsx.
  }
})

function startLdap(alias: string) {
  ldapAlias.value = alias
  ldapUsername.value = ''
  ldapPassword.value = ''
}

async function submitLdap(alias: string) {
  busy.value = true
  try {
    await authStore.ldapLogin(alias, ldapUsername.value, ldapPassword.value)
    emit('success')
  } catch (err: any) {
    emit('error', err.response?.data?.error || err.message || 'LDAP sign-in failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="providers.length" class="sso-providers">
    <div class="separator mt-8 mb-8">
      <span class="separator-text">or sign in with an identity provider</span>
    </div>

    <div class="form-group">
      <template v-for="p in providers.filter(p => p.type !== 'ldap')" :key="p.alias">
        <a
          :href="authStore.federationLoginUrl(p.alias, p.type as 'saml' | 'oidc')"
          class="btn btn-secondary"
          style="width: 100%; margin-bottom: var(--space-3); height: 48px;"
        >
          {{ p.displayName }} ({{ p.type.toUpperCase() }})
        </a>
      </template>

      <template v-for="p in providers.filter(p => p.type === 'ldap')" :key="p.alias">
        <form v-if="ldapAlias === p.alias" class="ldap-form" @submit.prevent="submitLdap(p.alias)">
          <input v-model="ldapUsername" type="text" class="form-input mb-3" required placeholder="LDAP username" autofocus />
          <input v-model="ldapPassword" type="password" class="form-input mb-3" required placeholder="LDAP password" />
          <div style="display: flex; gap: var(--space-3);">
            <button type="button" class="btn btn-secondary" style="flex: 1; height: 40px;" @click="ldapAlias = null">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex: 1; height: 40px;" :disabled="busy">
              {{ busy ? 'Signing in...' : 'Sign In' }}
            </button>
          </div>
        </form>
        <button
          v-else
          type="button"
          class="btn btn-secondary"
          style="width: 100%; margin-bottom: var(--space-3); height: 48px;"
          @click="startLdap(p.alias)"
        >
          {{ p.displayName }} (LDAP)
        </button>
      </template>
    </div>

    <p class="text-xs text-muted mb-0">
      SAML/OIDC providers redirect through the main app (federation callbacks are same-origin
      only) and hand you back there once signed in — only LDAP completes inside this demo.
    </p>
  </div>
</template>

<style scoped>
.ldap-form { border: 1px solid var(--slate-100); border-radius: var(--radius-lg); padding: var(--space-4); margin-bottom: var(--space-3); }
</style>
