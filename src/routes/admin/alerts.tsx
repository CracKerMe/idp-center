import { createFileRoute } from '@tanstack/react-router';
import { AlertPanel } from '../../pages/admin/AlertPanel';

export const Route = createFileRoute('/admin/alerts')({
  component: AlertPanel,
});
