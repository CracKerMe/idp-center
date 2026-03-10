import { createFileRoute } from '@tanstack/react-router';
import ClientsList from '../../pages/admin/ClientsList';

export const Route = createFileRoute('/admin/clients')({
  component: ClientsList,
});
