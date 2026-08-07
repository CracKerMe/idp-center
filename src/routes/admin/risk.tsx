import { createFileRoute } from '@tanstack/react-router';
import RiskDashboard from '../../pages/admin/RiskDashboard';

export const Route = createFileRoute('/admin/risk')({
  component: RiskDashboard,
});
