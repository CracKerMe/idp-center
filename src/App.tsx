/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root';
import { routeTree } from './routeTree.gen';
import { authFetch } from './utils/fetch';

const router = createRouter({ 
  routeTree,
  context: { user: null, setUser: () => {} }
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      authFetch('/api/auth/me')
      .then(res => {
        if (res.status === 401 || res.status === 403) {
          // Token invalid or revoked, clear storage
          localStorage.removeItem('token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('session_id');
          setUser(null);
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then(data => {
        if (data) {
          setUser(data);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return <RouterProvider router={router} context={{ user, setUser }} />;
}
