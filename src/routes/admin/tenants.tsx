import { createFileRoute } from '@tanstack/react-router';
import TenantsList from '../../pages/admin/TenantsList';

export const Route = createFileRoute('/admin/tenants')({
  component: TenantsList,
});
