'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, unwrapList } from '@/lib/api';
import type { Alert } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatusBadge } from '@/components/Badge';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';

const SEVERITIES = ['all', 'critical', 'high', 'medium', 'low'] as const;
const STATUSES = ['all', 'open', 'acknowledged', 'resolved'] as const;

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('all');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.alerts();
      setAlerts(unwrapList<Alert>(res));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return alerts.filter((alert) => {
      const sevMatch = severity === 'all' || (alert.severity ?? '').toLowerCase() === severity;
      const statusMatch = status === 'all' || (alert.status ?? '').toLowerCase() === status;
      return sevMatch && statusMatch;
    });
  }, [alerts, severity, status]);

  async function handleResolve(id: string) {
    setResolvingId(id);
    try {
      await api.resolveAlert(id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'resolved' } : a)));
    } catch {
      // surfaced implicitly by leaving status unchanged; keep UI resilient
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <>
      <TopBar title="Alerts" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-4 flex gap-3">
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as (typeof SEVERITIES)[number])}
            className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All severities' : s}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as (typeof STATUSES)[number])}
            className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : s}
              </option>
            ))}
          </select>
        </div>

        {loading ? <LoadingState label="Loading alerts" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading && !error ? (
          filtered.length > 0 ? (
            <div className="panel overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-base-border text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-5 py-3 font-medium">Alert</th>
                    <th className="px-5 py-3 font-medium">Agent</th>
                    <th className="px-5 py-3 font-medium">Severity</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                    <th className="px-5 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((alert) => (
                    <tr key={alert.id} className="border-b border-base-border last:border-0 hover:bg-base-panel2">
                      <td className="px-5 py-3 text-ink">{alert.title ?? alert.message ?? 'Alert'}</td>
                      <td className="px-5 py-3 text-ink-muted">{alert.agent_name ?? '--'}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={alert.severity} />
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={alert.status} />
                      </td>
                      <td className="px-5 py-3 text-ink-muted">
                        {alert.created_at ? new Date(alert.created_at).toLocaleString() : '--'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {alert.status !== 'resolved' ? (
                          <button
                            type="button"
                            onClick={() => handleResolve(alert.id)}
                            disabled={resolvingId === alert.id}
                            className="rounded-sm border border-base-border px-3 py-1 text-xs text-ink-muted hover:border-accent/50 hover:text-accent disabled:opacity-50"
                          >
                            {resolvingId === alert.id ? 'Resolving...' : 'Resolve'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No alerts match these filters." />
          )
        ) : null}
      </main>
    </>
  );
}
