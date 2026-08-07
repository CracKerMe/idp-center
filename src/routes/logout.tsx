import { createFileRoute } from '@tanstack/react-router';
import Logout from '../pages/Logout';

export const Route = createFileRoute('/logout')({
  component: Logout,
});
