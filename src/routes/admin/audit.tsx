import { createFileRoute } from '@tanstack/react-router';
import AuditLogs from '../../pages/admin/AuditLogs';

export const Route = createFileRoute('/admin/audit')({
  component: AuditLogs,
});
