import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, ShieldCheck, ShieldX, Users, RefreshCw } from 'lucide-react';
import { authFetch, parseApiResponse, isSuccess } from '../../utils/fetch';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import AdminTable from '../../components/admin/AdminTable';

interface DashboardData {
  mode: string;
  outcomes: Record<string, number>;
  topRiskyUsers: { userId: string; avgScore: number; n: number }[];
  signalDistribution: Record<string, number>;
}

interface LoginEvent {
  id: string;
  userId: string | null;
  outcome: string;
  ip: string | null;
  country: string | null;
  riskScore: number | null;
  riskAction: string | null;
  riskReasons: { code: string; weight: number; detail?: string }[];
  createdAt: string;
}

export default function RiskDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningUeba, setRunningUeba] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [dashRes, eventsRes] = await Promise.all([
      authFetch('/api/admin/risk/dashboard'),
      authFetch('/api/admin/risk/events?limit=20'),
    ]);
    const dash = await parseApiResponse<DashboardData>(dashRes);
    if (isSuccess(dash) && dash.data) setData(dash.data);
    const ev = await parseApiResponse<any>(eventsRes);
    if (isSuccess(ev) && ev.data) setEvents(ev.data.items || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const runUeba = async () => {
    setRunningUeba(true);
    try {
      await authFetch('/api/admin/risk/ueba/run', { method: 'POST' });
      await fetchAll();
    } finally {
      setRunningUeba(false);
    }
  };

  const modeColor = data?.mode === 'enforce' ? 'text-red-600' : data?.mode === 'shadow' ? 'text-amber-600' : 'text-zinc-500';

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Risk Dashboard"
        description="Adaptive authentication: login risk scoring and UEBA baselines (implementation plan phase 3)."
        actions={
          <button
            onClick={runUeba}
            disabled={runningUeba}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${runningUeba ? 'animate-spin' : ''}`} />
            Recompute baselines
          </button>
        }
      />

      <div className="px-4 sm:px-6">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Risk engine mode: <span className={`font-semibold ${modeColor}`}>{data?.mode ?? '...'}</span>
          {data?.mode === 'shadow' && ' — scoring only, no logins are blocked yet.'}
          {data?.mode === 'off' && ' — set RISK_ENGINE_MODE=shadow to start collecting signals.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 px-4 sm:px-6">
        <StatCard icon={ShieldCheck} label="Allowed (30d)" value={data?.outcomes?.success ?? 0} color="text-green-600" />
        <StatCard icon={ShieldAlert} label="Challenged (30d)" value={data?.outcomes?.challenged ?? 0} color="text-amber-600" />
        <StatCard icon={ShieldX} label="Blocked (30d)" value={data?.outcomes?.blocked ?? 0} color="text-red-600" />
        <StatCard icon={Users} label="Failed (30d)" value={data?.outcomes?.fail ?? 0} color="text-zinc-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 px-4 sm:px-6">
        <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-5">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Top risky users (avg score, 30d)</h3>
          <ul className="space-y-2">
            {(data?.topRiskyUsers || []).map((u) => (
              <li key={u.userId} className="flex justify-between text-sm">
                <span className="text-zinc-600 dark:text-zinc-400 truncate">{u.userId}</span>
                <span className="font-mono">{u.avgScore} <span className="text-zinc-400">({u.n} logins)</span></span>
              </li>
            ))}
            {(!data?.topRiskyUsers || data.topRiskyUsers.length === 0) && (
              <li className="text-sm text-zinc-400">No risk-scored logins yet.</li>
            )}
          </ul>
        </div>

        <div className="bg-white dark:bg-zinc-900 shadow rounded-lg p-5">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Signal distribution (30d)</h3>
          <ul className="space-y-2">
            {Object.entries(data?.signalDistribution || {}).sort((a, b) => b[1] - a[1]).map(([code, n]) => (
              <li key={code} className="flex justify-between text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">{code}</span>
                <span className="font-mono">{n}</span>
              </li>
            ))}
            {Object.keys(data?.signalDistribution || {}).length === 0 && (
              <li className="text-sm text-zinc-400">No signals recorded yet.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="px-4 sm:px-6 pb-6">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Recent login events</h3>
        <AdminTable minWidthClass="min-w-225">
          <thead className="bg-zinc-50 dark:bg-zinc-800">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Time</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Outcome</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Score</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Action</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Country</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">IP</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-700">
            {loading ? (
              <tr><td colSpan={7} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading...</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={7} className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No login events recorded yet.</td></tr>
            ) : events.map((ev) => (
              <tr key={ev.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{new Date(ev.createdAt).toLocaleString()}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900 dark:text-white font-mono truncate max-w-[10rem]">{ev.userId || '—'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    ev.outcome === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                    ev.outcome === 'blocked' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                    ev.outcome === 'challenged' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' :
                    'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300'
                  }`}>{ev.outcome}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-zinc-500 dark:text-zinc-400">{ev.riskScore ?? '—'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{ev.riskAction ?? '—'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{ev.country ?? '—'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400 font-mono">{ev.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 overflow-hidden shadow rounded-lg">
      <div className="p-5 flex items-center gap-4">
        <Icon className={`w-8 h-8 ${color}`} />
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
          <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
        </div>
      </div>
    </div>
  );
}
