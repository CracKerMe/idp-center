import { createFileRoute, redirect } from '@tanstack/react-router';
import Authorize from '../pages/Authorize';

export const Route = createFileRoute('/authorize')({
  beforeLoad: ({ context, location }) => {
    if (!context.user) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
        hash: 'oauth'
      });
    }
  },
  component: function AuthorizeComponent() {
    const { user } = Route.useRouteContext();
    return <Authorize user={user} />;
  },
});
