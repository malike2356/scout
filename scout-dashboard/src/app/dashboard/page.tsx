'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '@/lib/api';
import type { KeprixDashboardStatus, OverviewData } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/Badge';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [keprix, setKeprix] = useState<KeprixDashboardStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [res, keprixRes] = await Promise.all([
        api.overview(),
        api.keprixStatus().catch(() => null),
      ]);
      setData(res ?? {});
      setKeprix(keprixRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const trend = data?.score_trend ?? [];
  const recentAlerts = data?.recent_alerts ?? [];
  const stats = keprix?.stats_24h;

  return (
    <>
      <TopBar title="Overview" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? <LoadingState label="Loading overview" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading && !error ? (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-4 gap-4">
              <StatCard label="Agents online" value={data?.agents_online ?? 0} hint={`${data?.agents_total ?? 0} total`} tone="accent" />
              <StatCard label="Alerts today" value={data?.alerts_today ?? 0} tone={data?.alerts_today ? 'danger' : 'default'} />
              <StatCard label="Security score" value={data?.security_score ?? '--'} tone="accent" />
              <StatCard label="API calls today" value={data?.api_calls_today ?? 0} />
            </div>

            {keprix ? (
              <div className="panel px-5 py-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-ink">Keprix agent status</h2>
                  <StatusBadge
                    status={
                      keprix.kill_switch_active
                        ? 'critical'
                        : keprix.health?.ok
                          ? 'online'
                          : keprix.configured
                            ? 'offline'
                            : 'info'
                    }
                  />
                </div>
                {!keprix.configured && !(keprix.registered_targets?.length) ? (
                  <EmptyState message="No Keprix target registered yet. Set KEPRIX_URL or POST /api/admin/targets." />
                ) : (
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div>
                      <div className="text-xs text-ink-faint">Health</div>
                      <div className="text-sm text-ink">
                        {keprix.health?.ok ? 'Healthy' : keprix.health?.error || 'Unreachable'}
                        {keprix.health?.latency_ms != null ? ` (${keprix.health.latency_ms} ms)` : ''}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-faint">Sessions</div>
                      <div className="text-sm text-ink">
                        {keprix.agents?.online ?? 0} online / {keprix.agents?.total ?? 0} total
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-faint">Prompt filter (24h)</div>
                      <div className="text-sm text-ink">
                        {stats?.passed ?? 0} passed / {stats?.blocked ?? 0} blocked / {stats?.flagged ?? 0} flagged
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-faint">Tools / kill</div>
                      <div className="text-sm text-ink">
                        {stats?.tool_calls ?? 0} tool events;{' '}
                        {keprix.kill_switch_active ? 'KILL ACTIVE' : 'armed'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid grid-cols-3 gap-4">
              <div className="panel col-span-2 px-5 py-4">
                <h2 className="mb-4 text-sm font-semibold text-ink">Security score trend</h2>
                {trend.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend}>
                        <XAxis
                          dataKey="date"
                          stroke="var(--color-text-faint)"
                          tick={{ fontSize: 12 }}
                          tickLine={false}
                          axisLine={{ stroke: 'var(--color-border)' }}
                        />
                        <YAxis
                          stroke="var(--color-text-faint)"
                          tick={{ fontSize: 12 }}
                          tickLine={false}
                          axisLine={{ stroke: 'var(--color-border)' }}
                          width={30}
                        />
                        <Tooltip
                          contentStyle={{
                            background: 'var(--color-panel)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="score"
                          stroke="var(--color-accent)"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState message="No score history yet." />
                )}
              </div>

              <div className="panel px-5 py-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-ink">Recent alerts</h2>
                  <Link href="/dashboard/alerts" className="text-xs text-accent hover:text-accent-hover">
                    View all
                  </Link>
                </div>
                {recentAlerts.length > 0 ? (
                  <ul className="flex flex-col gap-3">
                    {recentAlerts.slice(0, 6).map((alert) => (
                      <li key={alert.id} className="flex items-start justify-between gap-2 text-sm">
                        <div className="flex flex-col">
                          <span className="text-ink">{alert.title ?? alert.message ?? 'Alert'}</span>
                          <span className="text-xs text-ink-faint">{alert.agent_name ?? 'Unknown agent'}</span>
                        </div>
                        <StatusBadge status={alert.severity} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState message="No alerts yet." />
                )}
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
