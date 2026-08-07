import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { fetchAlerts, acknowledgeAlert, resolveAlert, useAlertStream, type Alert, type AlertCounts } from '../../hooks/useAlertStream';
import { Bell, CheckCircle, AlertTriangle, XCircle, Info, Filter, Wifi, WifiOff } from 'lucide-react';

const SEVERITY_CONFIG = {
  info: { color: 'text-blue-600', bg: 'bg-blue-50', icon: Info, label: '信息' },
  low: { color: 'text-green-600', bg: 'bg-green-50', icon: Info, label: '低' },
  medium: { color: 'text-yellow-600', bg: 'bg-yellow-50', icon: AlertTriangle, label: '中' },
  high: { color: 'text-orange-600', bg: 'bg-orange-50', icon: AlertTriangle, label: '高' },
  critical: { color: 'text-red-600', bg: 'bg-red-50', icon: XCircle, label: '严重' },
} as const;

const STATUS_CONFIG = {
  open: { color: 'text-red-600', label: '待处理' },
  acknowledged: { color: 'text-yellow-600', label: '已确认' },
  resolved: { color: 'text-green-600', label: '已解决' },
  false_positive: { color: 'text-gray-500', label: '误报' },
} as const;

export function AlertPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [counts, setCounts] = useState<AlertCounts>({ open: 0, acknowledged: 0, resolved: 0, false_positive: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<{ status?: string; severity?: string }>({});
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const countedIdsRef = useRef(new Set<string>());

  // Real-time SSE connection for live alert updates
  const { alerts: sseAlerts, isConnected } = useAlertStream();

  // Merge SSE alerts into the list (prepend new ones, deduplicate by id)
  useEffect(() => {
    if (sseAlerts.length === 0) return;

    // 1. Compute new alerts (those not yet in the current list)
    // We use a ref to track which IDs we've already counted for the open tally,
    // since setAlerts updater is called twice in StrictMode and must stay pure.
    setAlerts(prev => {
      const existingIds = new Set(prev.map(a => a.id));
      const newAlerts = sseAlerts.filter(a => !existingIds.has(a.id));
      return newAlerts.length > 0 ? [...newAlerts, ...prev] : prev;
    });

    // 2. Count open alerts from truly-new arrivals (outside any updater)
    const newOpen = sseAlerts.filter(
      a => a.status === 'open' && !countedIdsRef.current.has(a.id),
    ).length;
    // Mark all current sseAlerts as counted
    for (const a of sseAlerts) countedIdsRef.current.add(a.id);
    if (newOpen > 0) {
      setCounts(c => ({ ...c, open: c.open + newOpen }));
    }
  }, [sseAlerts]);

  const loadAlerts = async () => {
    try {
      setLoading(true);
      const data = await fetchAlerts({ ...filter, limit: 50 });
      setAlerts(data.alerts);
      setCounts(data.counts);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAlerts(); }, [filter]);

  const handleAcknowledge = async (id: string) => {
    try {
      await acknowledgeAlert(id);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'acknowledged' } : a));
      setCounts(prev => ({ ...prev, open: prev.open - 1, acknowledged: prev.acknowledged + 1 }));
    } catch (err) {
      console.error('Failed to acknowledge:', err);
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await resolveAlert(id);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'resolved' } : a));
      setCounts(prev => ({ ...prev, open: prev.open - 1, resolved: prev.resolved + 1 }));
    } catch (err) {
      console.error('Failed to resolve:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="w-6 h-6" /> 告警中心
        </h1>
        <div className="flex items-center gap-3">
          {/* SSE connection status */}
          <div className={clsx(
            'flex items-center gap-1 text-xs px-2 py-1 rounded-full',
            isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
          )}>
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isConnected ? '实时连接' : '已断开'}
          </div>
          <button onClick={loadAlerts} className="px-3 py-1.5 text-sm bg-gray-100 rounded hover:bg-gray-200">
            刷新
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {([
          { key: 'open', label: '待处理', color: 'border-red-500 text-red-600' },
          { key: 'acknowledged', label: '已确认', color: 'border-yellow-500 text-yellow-600' },
          { key: 'resolved', label: '已解决', color: 'border-green-500 text-green-600' },
          { key: 'false_positive', label: '误报', color: 'border-gray-400 text-gray-500' },
        ] as const).map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setFilter(prev => ({ ...prev, status: prev.status === key ? undefined : key }))}
            className={clsx(
              'p-4 rounded-lg border-2 transition-all text-left',
              filter.status === key ? color : 'border-gray-200 hover:border-gray-300',
            )}
          >
            <div className="text-2xl font-bold">{counts[key]}</div>
            <div className="text-sm text-gray-500">{label}</div>
          </button>
        ))}
      </div>

      {/* Severity Filter */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-500">严重度：</span>
        {(['info', 'low', 'medium', 'high', 'critical'] as const).map(sev => (
          <button
            key={sev}
            onClick={() => setFilter(prev => ({ ...prev, severity: prev.severity === sev ? undefined : sev }))}
            className={clsx(
              'px-2 py-1 text-xs rounded-full transition-all',
              filter.severity === sev
                ? `${SEVERITY_CONFIG[sev].bg} ${SEVERITY_CONFIG[sev].color} font-medium`
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
            )}
          >
            {SEVERITY_CONFIG[sev].label}
          </button>
        ))}
      </div>

      {/* Alert List */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-8 text-gray-400">加载中...</div>
        ) : alerts.length === 0 ? (
          <div className="text-center py-8 text-gray-400">暂无告警</div>
        ) : (
          alerts.map(alert => {
            const severityConf = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
            const statusConf = STATUS_CONFIG[alert.status] ?? STATUS_CONFIG.open;
            const Icon = severityConf.icon;

            return (
              <div
                key={alert.id}
                className={clsx(
                  'p-4 rounded-lg border transition-all cursor-pointer hover:shadow-md',
                  severityConf.bg,
                  selectedAlert?.id === alert.id ? 'ring-2 ring-blue-400' : '',
                )}
                onClick={() => setSelectedAlert(selectedAlert?.id === alert.id ? null : alert)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Icon className={clsx('w-5 h-5 mt-0.5', severityConf.color)} />
                    <div>
                      <div className="font-medium">{alert.title}</div>
                      <div className="text-sm text-gray-600 mt-1">{alert.description}</div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                        <span>{new Date(alert.createdAt).toLocaleString('zh-CN')}</span>
                        <span className={statusConf.color}>{statusConf.label}</span>
                        <span className="capitalize">{alert.category}</span>
                      </div>
                    </div>
                  </div>

                  {alert.status === 'open' && (
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAcknowledge(alert.id); }}
                        className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                      >
                        确认
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolve(alert.id); }}
                        className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                      >
                        解决
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded details */}
                {selectedAlert?.id === alert.id && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <pre className="text-xs bg-white p-2 rounded overflow-x-auto">
                      {JSON.stringify(alert.metadata, null, 2)}
                    </pre>
                    {alert.sourceEventId && (
                      <div className="text-xs text-gray-400 mt-2">
                        源事件: {alert.sourceEventId}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
