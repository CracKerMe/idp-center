import { createFileRoute, redirect } from '@tanstack/react-router';
import Profile from '../pages/Profile';
import type { AuthUser } from '../types/user';

export const Route = createFileRoute('/profile')({
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: '/login' });
  },
  component: function ProfileComponent() {
    const { user, setUser } = Route.useRouteContext();
    return <Profile user={user!} setUser={setUser as (user: AuthUser) => void} />;
  },
});
