import { useCallback, useEffect, useState } from 'react';
import { authFetch, parseApiResponse, isSuccess } from '../utils/fetch';

/**
 * Public feature flags safe to expose unauthenticated (login page affordances). Falls back
 * to an empty object on failure — fail closed on nav/UI items, since a dead link is worse
 * than a hidden one.
 */
export function usePublicFeatures(): Record<string, boolean> | null {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    fetch('/api/features/public')
      .then(r => r.json())
      .then(json => setFlags(json.code === 0 ? json.data : {}))
      .catch(() => setFlags({}));
  }, []);

  return flags;
}

export interface ResolvedFeature {
  key: string;
  category: string;
  categoryLabel: string;
  label: string;
  description: string;
  type: 'boolean' | 'triState';
  options?: readonly string[];
  value: boolean | string;
  source: 'db' | 'env';
  effectiveImmediately: boolean;
  implemented: boolean;
  dependsOn: string[];
  dependenciesSatisfied: boolean;
  hardRequirementUnmet: boolean;
  hardRequirementReason?: string;
}

export function useAdminFeatures() {
  const [items, setItems] = useState<ResolvedFeature[] | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await authFetch('/api/admin/features');
    const json = await parseApiResponse<ResolvedFeature[]>(res);
    if (isSuccess(json) && json.data) setItems(json.data);
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { items, loading, reload };
}
