import { createFileRoute, redirect } from '@tanstack/react-router';
import Dashboard from '../pages/Dashboard';

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { github_code?: string; session_id?: string } => {
    return {
      github_code: search.github_code as string | undefined,
      session_id: search.session_id as string | undefined,
    };
  },
  beforeLoad: async ({ context }) => {
    // OAuth callback tokens are handled in App.tsx before routing
    if (!context.user) throw redirect({ to: '/login' });
  },
  component: function IndexComponent() {
    const { user, setUser } = Route.useRouteContext();
    return <Dashboard user={user} setUser={setUser} />;
  },
});
