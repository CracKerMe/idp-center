import { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { Shield, Activity, Zap, Clock, CheckCircle, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { authFetch } from '../../utils/fetch';

interface HealthCheckItem {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  value: number | string;
  threshold: number | string;
  message: string;
  autoHeal?: string;
}

interface HealthCheckResult {
  score: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckItem[];
  recommendations: string[];
  timestamp: string;
}

interface AutoHealRule {
  id: string;
  name: string;
  enabled: boolean;
  requiresConfirmation: boolean;
}

interface AutoHealLogEntry {
  ruleId: string;
  ruleName: string;
  actionType: string;
  status: string;
  error?: string;
  executedAt: string;
}

const STATUS_ICON = {
  pass: CheckCircle,
  warn: AlertTriangle,
  fail: XCircle,
} as const;

const STATUS_COLOR = {
  pass: 'text-green-600',
  warn: 'text-yellow-600',
  fail: 'text-red-600',
} as const;

const HEALTH_STATUS_COLOR = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  unhealthy: 'bg-red-500',
} as const;

export function OperationsCenter() {
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [healLog, setHealLog] = useState<AutoHealLogEntry[]>([]);
  const [rules, setRules] = useState<AutoHealRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealth = async () => {
    try {
      const res = await authFetch('/api/ops/health/comprehensive');
      const json = await res.json();
      if (json.code === 0) setHealth(json.data);
    } catch (err) {
      console.error('Health check failed:', err);
    }
  };

  const fetchHealData = async () => {
    try {
      const [logRes, rulesRes] = await Promise.all([
        authFetch('/api/ops/auto-heal/log?hours=24'),
        authFetch('/api/ops/auto-heal/rules'),
      ]);
      const logJson = await logRes.json();
      const rulesJson = await rulesRes.json();
      if (logJson.code === 0) setHealLog(logJson.data);
      if (rulesJson.code === 0) setRules(rulesJson.data);
    } catch (err) {
      console.error('Auto-heal data fetch failed:', err);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([fetchHealth(), fetchHealData()]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    try {
      await authFetch(`/api/ops/auto-heal/rules/${ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r));
    } catch (err) {
      console.error('Toggle rule failed:', err);
    }
  };

  const handleManualTick = async () => {
    try {
      await authFetch('/api/ops/auto-heal/tick', {
        method: 'POST',
      });
      // Refresh log after tick
      await fetchHealData();
    } catch (err) {
      console.error('Manual tick failed:', err);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-400">加载中...</div>;
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6" /> 运维中心
        </h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-4 h-4', refreshing && 'animate-spin')} />
          刷新
        </button>
      </div>

      {/* Health Score */}
      {health && (
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-6">
            <div className={clsx(
              'w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-bold',
              HEALTH_STATUS_COLOR[health.status],
            )}>
              {health.score}
            </div>
            <div>
              <div className="text-lg font-medium">
                系统状态：
                <span className={clsx(
                  health.status === 'healthy' ? 'text-green-600' :
                  health.status === 'degraded' ? 'text-yellow-600' : 'text-red-600',
                )}>
                  {health.status === 'healthy' ? '健康' : health.status === 'degraded' ? '降级' : '不健康'}
                </span>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                检查时间：{new Date(health.timestamp).toLocaleString('zh-CN')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Health Checks */}
      {health && (
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5" /> 健康检查项
          </h2>
          <div className="space-y-3">
            {health.checks.map(check => {
              const Icon = STATUS_ICON[check.status];
              return (
                <div key={check.name} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div className="flex items-center gap-3">
                    <Icon className={clsx('w-5 h-5', STATUS_COLOR[check.status])} />
                    <div>
                      <div className="font-medium text-sm">{check.name}</div>
                      <div className="text-xs text-gray-500">{check.message}</div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-400">
                    {typeof check.value === 'number' ? `${check.value}` : check.value}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {health && health.recommendations.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-medium text-yellow-800 mb-2">建议</h3>
          <ul className="space-y-1">
            {health.recommendations.map((rec, i) => (
              <li key={i} className="text-sm text-yellow-700">{rec}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Auto-Heal Rules */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium flex items-center gap-2">
            <Zap className="w-5 h-5" /> 自动修复规则
          </h2>
          <button
            onClick={handleManualTick}
            className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
          >
            手动触发
          </button>
        </div>
        <div className="space-y-2">
          {rules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
              <div>
                <div className="font-medium text-sm">{rule.name}</div>
                <div className="text-xs text-gray-400">
                  {rule.requiresConfirmation ? '需要确认' : '自动执行'}
                </div>
              </div>
              <button
                onClick={() => handleToggleRule(rule.id, !rule.enabled)}
                className={clsx(
                  'px-3 py-1 text-xs rounded-full transition-all',
                  rule.enabled
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-200 text-gray-500 hover:bg-gray-300',
                )}
              >
                {rule.enabled ? '已启用' : '已禁用'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-Heal Log */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" /> 修复日志（24 小时）
        </h2>
        {healLog.length === 0 ? (
          <div className="text-center py-4 text-gray-400">暂无修复记录</div>
        ) : (
          <div className="space-y-2">
            {healLog.map((entry, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div className="flex items-center gap-3">
                  {entry.status === 'success' ? (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600" />
                  )}
                  <div>
                    <div className="text-sm font-medium">{entry.ruleName}</div>
                    <div className="text-xs text-gray-400">
                      {new Date(entry.executedAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">{entry.actionType}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
