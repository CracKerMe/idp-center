import { createFileRoute } from '@tanstack/react-router';
import FeatureFlags from '../../pages/admin/FeatureFlags';

export const Route = createFileRoute('/admin/features')({
  component: FeatureFlags,
});
