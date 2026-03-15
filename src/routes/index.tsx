import { createFileRoute, redirect } from '@tanstack/react-router';
import Dashboard from '../pages/Dashboard';

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { access_token?: string; refresh_token?: string } => {
    return {
      access_token: search.access_token as string | undefined,
      refresh_token: search.refresh_token as string | undefined,
    };
  },
  beforeLoad: async ({ context, search }) => {
    // Handle OAuth callback tokens passed via URL params
    if (search.access_token && search.refresh_token) {
      localStorage.setItem('token', search.access_token);
      localStorage.setItem('refresh_token', search.refresh_token);
      // Fetch user info and update context
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${search.access_token}` },
      });
      if (res.ok) {
        const user = await res.json();
        context.setUser(user);
        throw redirect({ to: '/' });
      }
    }
    if (!context.user) throw redirect({ to: '/login' });
  },
  component: function IndexComponent() {
    const { user, setUser } = Route.useRouteContext();
    return <Dashboard user={user} setUser={setUser} />;
  },
});
