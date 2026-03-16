import { createFileRoute, redirect } from '@tanstack/react-router';
import ResetPassword from '../pages/ResetPassword';

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    return { token: search.token as string | undefined };
  },
  beforeLoad: ({ context }) => {
    if (context.user) throw redirect({ to: '/' });
  },
  component: ResetPassword,
});
