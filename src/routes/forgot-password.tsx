import { createFileRoute, redirect } from '@tanstack/react-router';
import ForgotPassword from '../pages/ForgotPassword';

export const Route = createFileRoute('/forgot-password')({
  beforeLoad: ({ context }) => {
    if (context.user) throw redirect({ to: '/' });
  },
  component: ForgotPassword,
});
