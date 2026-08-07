import { createFileRoute } from '@tanstack/react-router';
import { OperationsCenter } from '../../pages/admin/OperationsCenter';

export const Route = createFileRoute('/admin/operations')({
  component: OperationsCenter,
});
