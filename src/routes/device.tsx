import { createFileRoute, redirect } from '@tanstack/react-router';
import DeviceVerify from '../pages/DeviceVerify';

export const Route = createFileRoute('/device')({
  beforeLoad: ({ context }) => {
    if (!context.user) throw redirect({ to: '/login', search: { redirect: '/device' } });
  },
  component: function DeviceComponent() {
    const { user } = Route.useRouteContext();
    return <DeviceVerify user={user} />;
  },
});
