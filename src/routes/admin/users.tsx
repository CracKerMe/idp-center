import { createFileRoute } from '@tanstack/react-router';
import UsersList from '../../pages/admin/UsersList';

export const Route = createFileRoute('/admin/users')({
  component: UsersList,
});
