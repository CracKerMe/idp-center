import { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from '../utils/fetch';

export interface Alert {
  id: string;
  tenantId: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  category: 'auth' | 'risk' | 'compliance' | 'system';
  title: string;
  description: string;
  sourceEventId?: string;
  userId?: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'false_positive';
  metadata: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string;
}

export interface AlertCounts {
  open: number;
  acknowledged: number;
  resolved: number;
  false_positive: number;
}

/**
 * SSE hook for real-time alerts.
 * Uses query param token since EventSource cannot send Authorization header.
 * Reconnects with exponential backoff on errors.
 */
export function useAlertStream() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const retryCountRef = useRef(0);
  const maxRetries = 10;

  useEffect(() => {
    // Use 'token' key (consistent with authFetch) not 'access_token'
    const token = localStorage.getItem('token');
    if (!token) return;

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      // Pass token as query param — server accepts ?token= for SSE
      es = new EventSource(`/api/events/stream?token=${encodeURIComponent(token)}`);

      es.addEventListener('connected', () => {
        setIsConnected(true);
        retryCountRef.current = 0; // Reset on successful connection
      });

      es.addEventListener('alert', (e) => {
        try {
          const alert = JSON.parse(e.data) as Alert;
          setAlerts(prev => [alert, ...prev].slice(0, 100));
        } catch (_e) { /* ignore parse errors */ }
      });

      es.onerror = () => {
        setIsConnected(false);
        es?.close();

        // Exponential backoff reconnection (avoid 401 storm)
        if (mounted && retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
          retryTimeout = setTimeout(connect, delay);
        }
      };

      es.onopen = () => {
        setIsConnected(true);
      };
    };

    connect();

    return () => {
      mounted = false;
      es?.close();
      clearTimeout(retryTimeout);
      setIsConnected(false);
    };
  }, []);

  const clearAlerts = useCallback(() => setAlerts([]), []);

  return { alerts, isConnected, clearAlerts };
}

/** Fetch alerts via REST API — uses authFetch for automatic token refresh */
export async function fetchAlerts(params?: {
  status?: string;
  severity?: string;
  limit?: number;
  offset?: number;
}): Promise<{ alerts: Alert[]; counts: AlertCounts }> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.severity) searchParams.set('severity', params.severity);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const res = await authFetch(`/api/events/alerts?${searchParams}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.error);
  return json.data;
}

/** Acknowledge an alert — uses authFetch */
export async function acknowledgeAlert(alertId: string): Promise<void> {
  const res = await authFetch(`/api/events/alerts/${alertId}/acknowledge`, {
    method: 'POST',
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.error);
}

/** Resolve an alert — uses authFetch */
export async function resolveAlert(alertId: string, note?: string): Promise<void> {
  const res = await authFetch(`/api/events/alerts/${alertId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.error);
}
