import { createFileRoute } from '@tanstack/react-router';
import DashboardStats from '../../pages/admin/DashboardStats';

export const Route = createFileRoute('/admin/stats')({
  component: DashboardStats,
});
