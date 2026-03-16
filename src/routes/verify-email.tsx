import { createFileRoute, redirect } from '@tanstack/react-router';
import VerifyEmail from '../pages/VerifyEmail';

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    return { token: search.token as string | undefined };
  },
  beforeLoad: ({ context }) => {
    if (context.user) throw redirect({ to: '/' });
  },
  component: VerifyEmail,
});
