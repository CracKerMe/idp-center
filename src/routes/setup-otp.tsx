import { createFileRoute, redirect } from '@tanstack/react-router';
import SetupOTP from '../pages/SetupOTP';

export const Route = createFileRoute('/setup-otp')({
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: '/login' });
  },
  component: function SetupOtpComponent() {
    const { user, setUser } = Route.useRouteContext();
    return <SetupOTP user={user} setUser={setUser} />;
  },
});
