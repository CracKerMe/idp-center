import { createFileRoute, redirect, Outlet } from '@tanstack/react-router';
import AdminLayout from '../../layouts/AdminLayout';

export const Route = createFileRoute('/admin')({
  beforeLoad: ({ context }) => {
    if (!context.user?.is_admin) throw redirect({ to: '/' });
  },
  component: function AdminLayoutComponent() {
    const { user, setUser } = Route.useRouteContext();
    return <AdminLayout user={user} setUser={setUser} />;
  },
});
