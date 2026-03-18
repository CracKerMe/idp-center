/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { createRouter, RouterProvider, createHashHistory } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { authFetch } from './utils/fetch';

const hashHistory = createHashHistory();
const router = createRouter({ 
  routeTree,
  history: hashHistory,
  context: { user: null, setUser: () => {} }
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Initialize theme before rendering to prevent flash
function initializeTheme() {
  const stored = localStorage.getItem('idp-theme');
  const theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  
  let resolved: 'light' | 'dark';
  if (theme === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    resolved = theme;
  }
  
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

// Run theme initialization immediately
if (typeof window !== 'undefined') {
  initializeTheme();
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Handle GitHub OAuth callback — exchange short-lived code for tokens
    const params = new URLSearchParams(window.location.search);
    const githubCode = params.get('github_code');
    const sessionId = params.get('session_id');

    const init = async () => {
      if (githubCode) {
        // Clean up URL immediately (hash mode: keep hash, remove query params)
        window.history.replaceState({}, '', window.location.pathname + window.location.hash.split('?')[0]);
        try {
          const exchangeRes = await fetch('/api/auth/github/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: githubCode })
          });
          if (exchangeRes.ok) {
            const result = await exchangeRes.json();
            const data = result.data || result;
            localStorage.setItem('token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            if (sessionId) localStorage.setItem('session_id', sessionId);
            if (data.user) {
              setUser(data.user);
              setLoading(false);
              return;
            }
          }
        } catch {
          // Fall through to normal token check
        }
      }

      // Legacy: handle old-style tokens in URL (backwards compat)
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken) {
        localStorage.setItem('token', accessToken);
        if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
        // Hash mode: clean query params, keep hash
        window.history.replaceState({}, '', window.location.pathname + window.location.hash.split('?')[0]);
      }

      const token = localStorage.getItem('token');
      if (token) {
        try {
          const res = await authFetch('/api/auth/me');
          if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('session_id');
            setUser(null);
          } else if (res.ok) {
            const { data } = await res.json();
            if (data) setUser(data);
          }
        } catch {
          // ignore
        }
      }
      setLoading(false);
    };

    init();
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
      <div className="text-zinc-600 dark:text-zinc-300">Loading...</div>
    </div>
  );

  return <RouterProvider router={router} context={{ user, setUser }} />;
}
