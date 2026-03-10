import { createFileRoute, redirect } from '@tanstack/react-router';
import Login from '../pages/Login';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    return {
      redirect: search.redirect as string | undefined,
    };
  },
  beforeLoad: ({ context }) => {
    if (context.user) throw redirect({ to: '/' });
  },
  component: function LoginComponent() {
    const { setUser } = Route.useRouteContext();
    return <Login setUser={setUser} />;
  },
});
