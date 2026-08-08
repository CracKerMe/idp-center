import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import { authFetch, parseApiResponse, isSuccess } from '../../utils/fetch';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import { useAdminFeatures, type ResolvedFeature } from '../../hooks/useFeatures';

const TRI_STATE_LABELS: Record<string, string> = { off: 'Off', shadow: 'Shadow', enforce: 'Enforce' };

export default function FeatureFlags() {
  const { items, loading, reload } = useAdminFeatures();
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const map = new Map<string, ResolvedFeature[]>();
    for (const item of items ?? []) {
      const list = map.get(item.categoryLabel) ?? [];
      list.push(item);
      map.set(item.categoryLabel, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const setFlag = async (key: string, value: boolean | string) => {
    setPending(p => ({ ...p, [key]: true }));
    try {
      await authFetch(`/api/admin/features/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      await reload();
    } finally {
      setPending(p => ({ ...p, [key]: false }));
    }
  };

  const resetFlag = async (key: string) => {
    setPending(p => ({ ...p, [key]: true }));
    try {
      const res = await authFetch(`/api/admin/features/reset/${key}`, { method: 'POST' });
      await parseApiResponse(res);
      await reload();
    } finally {
      setPending(p => ({ ...p, [key]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Feature Flags"
        description="系统级功能开关。DB 覆盖值优先于 .env 默认值；改动即时生效，无需重启。"
      />

      <div className="px-4 sm:px-6 space-y-6">
        {loading && !items && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading...</p>
        )}

        {grouped.map(([categoryLabel, features]) => (
          <div key={categoryLabel} className="bg-white dark:bg-zinc-900 shadow rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{categoryLabel}</h3>
            </div>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {features.map(f => (
                <FeatureRow
                  key={f.key}
                  feature={f}
                  busy={!!pending[f.key]}
                  onChange={(v) => setFlag(f.key, v)}
                  onReset={() => resetFlag(f.key)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureRow({
  feature, busy, onChange, onReset,
}: {
  feature: ResolvedFeature;
  busy: boolean;
  onChange: (value: boolean | string) => void;
  onReset: () => void;
}) {
  const isOn = feature.type === 'boolean' ? feature.value === true : feature.value !== 'off';

  return (
    <div className="px-5 py-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{feature.label}</span>
          <code className="text-xs text-zinc-400">{feature.key}</code>
          <Badge tone={feature.source === 'db' ? 'indigo' : 'zinc'}>
            {feature.source === 'db' ? 'source: db' : 'source: env'}
          </Badge>
          {!feature.effectiveImmediately && <Badge tone="amber">重启生效</Badge>}
          {!feature.implemented && <Badge tone="zinc">尚未接入</Badge>}
          {!feature.dependenciesSatisfied && (
            <Badge tone="red">依赖未满足: {feature.dependsOn.join(', ')}</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{feature.description}</p>
        {feature.hardRequirementUnmet && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{feature.hardRequirementReason}</p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {feature.type === 'boolean' ? (
          <button
            type="button"
            role="switch"
            aria-checked={isOn}
            disabled={busy}
            onClick={() => onChange(!isOn)}
            className={clsx(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50',
              isOn ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700',
            )}
          >
            <span className={clsx(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              isOn ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
        ) : (
          <div className="inline-flex rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden">
            {(feature.options ?? []).map(opt => (
              <button
                key={opt}
                type="button"
                disabled={busy}
                onClick={() => onChange(opt)}
                className={clsx(
                  'px-3 py-1 text-xs font-medium disabled:opacity-50',
                  feature.value === opt
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800',
                )}
              >
                {TRI_STATE_LABELS[opt] ?? opt}
              </button>
            ))}
          </div>
        )}

        {feature.source === 'db' && (
          <button
            type="button"
            title="重置为默认值"
            disabled={busy}
            onClick={onReset}
            className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'indigo' | 'zinc' | 'amber' | 'red'; children: React.ReactNode }) {
  const toneClasses: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  };
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', toneClasses[tone])}>
      {children}
    </span>
  );
}
