/**
 * Authenticated fetch wrapper with automatic token refresh and cleanup
 */

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

/**
 * Refresh the access token using refresh token
 */
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refresh_token');
  
  if (!refreshToken) {
    return null;
  }
  
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    
    if (!response.ok) {
      throw new Error('Token refresh failed');
    }
    
    const data = await response.json();
    localStorage.setItem('token', data.access_token);
    
    if (data.refresh_token) {
      localStorage.setItem('refresh_token', data.refresh_token);
    }
    
    return data.access_token;
  } catch (error) {
    console.error('Token refresh failed:', error);
    return null;
  }
}

/**
 * Clear auth state and redirect to login
 */
function clearAuthAndRedirect(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('session_id');
  
  // Only redirect if not already on login page
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

/**
 * Authenticated fetch with automatic token refresh
 */
export async function authFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const { skipAuth = false, ...fetchOptions } = options;
  
  // Add auth headers if not skipping auth
  if (!skipAuth) {
    const token = localStorage.getItem('token');
    const sessionId = localStorage.getItem('session_id');
    
    fetchOptions.headers = {
      ...fetchOptions.headers,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(sessionId ? { 'X-Session-Id': sessionId } : {})
    };
  }
  
  // Make the initial request
  let response = await fetch(url, fetchOptions);
  
  // If 401 and not already refreshing, try to refresh token
  if (response.status === 401 && !skipAuth) {
    // If already refreshing, wait for it
    if (isRefreshing && refreshPromise) {
      const newToken = await refreshPromise;
      
      if (newToken) {
        // Retry with new token
        fetchOptions.headers = {
          ...fetchOptions.headers,
          'Authorization': `Bearer ${newToken}`
        };
        return fetch(url, fetchOptions);
      } else {
        // Refresh failed, clear and redirect
        clearAuthAndRedirect();
        return response;
      }
    }
    
    // Start refresh
    isRefreshing = true;
    refreshPromise = refreshAccessToken();
    
    try {
      const newToken = await refreshPromise;
      
      if (newToken) {
        // Retry with new token
        fetchOptions.headers = {
          ...fetchOptions.headers,
          'Authorization': `Bearer ${newToken}`
        };
        response = await fetch(url, fetchOptions);
      } else {
        // Refresh failed, clear and redirect
        clearAuthAndRedirect();
      }
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  }
  
  return response;
}

/**
 * Check if response is an auth error
 */
export function isAuthError(response: Response): boolean {
  return response.status === 401 || response.status === 403;
}
