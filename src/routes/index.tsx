import { createFileRoute, redirect } from '@tanstack/react-router';
import Dashboard from '../pages/Dashboard';

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: '/login' });
  },
  component: function IndexComponent() {
    const { user, setUser } = Route.useRouteContext();
    return <Dashboard user={user} setUser={setUser} />;
  },
});
