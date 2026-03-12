<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const user = computed(() => authStore.user)

// 直接从 localStorage 读取 token，确保总是有值
const token = computed(() => {
  const stored = localStorage.getItem('token')
  const fromStore = authStore.token
  console.log('Computing token - localStorage:', stored ? 'exists' : 'null', 'store:', fromStore ? 'exists' : 'null')
  return stored || fromStore
})

// 调试：检查 token 状态
onMounted(() => {
  console.log('=== Dashboard mounted ===')
  console.log('Token from localStorage:', localStorage.getItem('token'))
  console.log('Token from store:', authStore.token)
  console.log('User:', authStore.user)
  console.log('All localStorage:', { ...localStorage })
})

const tokenPayload = computed(() => {
  const tokenValue = token.value
  if (!tokenValue) {
    console.warn('No token available')
    return null
  }
  
  try {
    const parts = tokenValue.split('.')
    if (parts.length !== 3) {
      console.error('Invalid JWT format')
      return null
    }
    const payload = parts[1]
    const decoded = JSON.parse(atob(payload))
    console.log('Decoded payload:', decoded)
    return decoded
  } catch (error) {
    console.error('Failed to decode token:', error)
    return null
  }
})
</script>

<template>
  <div>
    <h1 style="font-size: 2rem; font-weight: 700; margin-bottom: 2rem;">
      Dashboard
    </h1>
    
    <div class="grid grid-2">
      <!-- User Info Card -->
      <div class="card">
        <h2 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem;">
          User Information
        </h2>
        
        <div v-if="user" style="display: grid; gap: 1rem;">
          <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">User ID</label>
            <p style="font-family: monospace; color: #1f2937;">{{ user.id }}</p>
          </div>
          
          <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">Username</label>
            <p style="font-weight: 500; color: #1f2937;">{{ user.username }}</p>
          </div>
          
          <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">Email</label>
            <p style="color: #1f2937;">{{ user.email }}</p>
          </div>
          
          <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">Admin</label>
            <p style="color: #1f2937;">{{ user.is_admin ? 'Yes' : 'No' }}</p>
          </div>
          
          <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">2FA Enabled</label>
            <p style="color: #1f2937;">{{ user.otp_enabled ? 'Yes' : 'No' }}</p>
          </div>
        </div>
      </div>
      
      <!-- Token Info Card -->
      <div class="card">
        <h2 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem;">
          JWT Token Information
        </h2>
        
        <div v-if="tokenPayload" style="display: grid; gap: 1rem;">
          <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">Subject (sub)</label>
            <p style="font-family: monospace; font-size: 0.875rem; color: #1f2937;">{{ tokenPayload.id }}</p>
          </div>
          
          <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">Username</label>
            <p style="font-weight: 500; color: #1f2937;">{{ tokenPayload.username }}</p>
          </div>
          
          <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">Issued At (iat)</label>
            <p style="color: #1f2937;">{{ new Date(tokenPayload.iat * 1000).toLocaleString() }}</p>
          </div>
          
          <div style="padding: 1rem; background: #f9fafb; border-radius: 0.5rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">Expires At (exp)</label>
            <p style="color: #1f2937;">{{ new Date(tokenPayload.exp * 1000).toLocaleString() }}</p>
          </div>
        </div>
        
        <div style="margin-top: 1.5rem;">
          <label style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.5rem; display: block;">
            Full Token
          </label>
          <div v-if="token" style="padding: 1rem; background: #1f2937; border-radius: 0.5rem; overflow-x: auto;">
            <code style="color: #10b981; font-size: 0.75rem; white-space: pre-wrap; word-break: break-all;">
              {{ token }}
            </code>
          </div>
          <div v-else style="padding: 1rem; background: #fef3c7; border-radius: 0.5rem;">
            <p style="color: #92400e; font-size: 0.875rem;">No token available</p>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Integration Guide -->
    <div class="card" style="margin-top: 2rem;">
      <h2 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem;">
        How to Integrate IDP Center
      </h2>
      
      <div style="display: grid; gap: 1rem;">
        <div style="padding: 1.5rem; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 0.5rem;">
          <h3 style="font-weight: 600; color: #1e40af; margin-bottom: 0.5rem;">Method 1: Direct Login</h3>
          <p style="color: #1e3a8a; font-size: 0.875rem;">
            Use the login form to authenticate directly with username and password. 
            The server returns a JWT token that should be stored and sent in the Authorization header.
          </p>
        </div>
        
        <div style="padding: 1.5rem; background: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 0.5rem;">
          <h3 style="font-weight: 600; color: #166534; margin-bottom: 0.5rem;">Method 2: OAuth2 Authorization Code Flow</h3>
          <p style="color: #14532d; font-size: 0.875rem;">
            Redirect users to /authorize endpoint with client_id, redirect_uri, and response_type=code.
            After user approves, exchange the authorization code for an access token.
          </p>
        </div>
        
        <div style="padding: 1.5rem; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0.5rem;">
          <h3 style="font-weight: 600; color: #92400e; margin-bottom: 0.5rem;">Security Best Practices</h3>
          <ul style="color: #78350f; font-size: 0.875rem; margin-left: 1rem;">
            <li>Always use HTTPS in production</li>
            <li>Store tokens securely (httpOnly cookies are recommended)</li>
            <li>Implement token refresh mechanism</li>
            <li>Verify JWT signatures on the server side</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
