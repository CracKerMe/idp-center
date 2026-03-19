/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { createRouter, RouterProvider, createHashHistory } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { authFetch, parseApiResponse, isSuccess } from './utils/fetch';

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
    // In hash mode, query params are after the hash (e.g., /#/?github_code=xxx)
    const hash = window.location.hash;
    const hashQueryIndex = hash.indexOf('?');
    const hashQuery = hashQueryIndex !== -1 ? hash.slice(hashQueryIndex + 1) : '';
    const hashParams = new URLSearchParams(hashQuery);
    const githubCode = hashParams.get('github_code');
    const sessionId = hashParams.get('session_id');

    const init = async () => {
      if (githubCode) {
        // Clean up URL immediately (hash mode: keep hash path, remove query params)
        const cleanHash = hashQueryIndex !== -1 ? hash.slice(0, hashQueryIndex) : hash;
        window.history.replaceState({}, '', window.location.pathname + cleanHash);
        try {
          const exchangeRes = await fetch('/api/auth/github/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: githubCode })
          });
          const result = await parseApiResponse<{ access_token: string; refresh_token: string; user: any }>(exchangeRes);
          if (isSuccess(result) && result.data) {
            const data = result.data;
            localStorage.setItem('token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            if (sessionId) localStorage.setItem('session_id', sessionId);
            if (data.user) {
              const redirectTarget = localStorage.getItem('github_post_login_redirect');
              localStorage.removeItem('github_post_login_redirect');
              setUser(data.user);
              setLoading(false);
              if (
                redirectTarget &&
                redirectTarget.startsWith('/') &&
                !redirectTarget.startsWith('//')
              ) {
                window.location.replace('/#' + redirectTarget);
              } else {
                window.location.replace('/#/');
              }
              return;
            }
          }
        } catch (error) {
          console.error('Error exchanging GitHub code:', error);
          // Fall through to normal token check
        }
      }

      // Legacy: handle old-style tokens in URL (backwards compat)
      const params = new URLSearchParams(window.location.search);
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
          } else {
            const result = await parseApiResponse<any>(res);
            if (isSuccess(result) && result.data) {
              setUser(result.data);
            }
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
