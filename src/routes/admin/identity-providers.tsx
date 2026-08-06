import { createFileRoute } from '@tanstack/react-router';
import IdentityProviders from '../../pages/admin/IdentityProviders';

export const Route = createFileRoute('/admin/identity-providers')({
  component: IdentityProviders,
});
