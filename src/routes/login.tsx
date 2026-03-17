import { createFileRoute, redirect } from '@tanstack/react-router';
import Login from '../pages/Login';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string; error?: string } => {
    return {
      redirect: search.redirect as string | undefined,
      error: search.error as string | undefined,
    };
  },
  beforeLoad: ({ context, search }) => {
    if (context.user) {
      const redirectTo = search.redirect;
      if (redirectTo && typeof redirectTo === 'string' && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
        throw redirect({ to: redirectTo as any });
      }
      throw redirect({ to: '/' });
    }
  },
  component: function LoginComponent() {
    const { setUser } = Route.useRouteContext();
    return <Login setUser={setUser} />;
  },
});
