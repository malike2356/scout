'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '@/lib/api';
import type { BoundaryDecision, GovernanceGaps, GovernanceHealth } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatCard } from '@/components/StatCard';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';
import { GovernanceNav } from '@/components/governance/GovernanceNav';

// How far back the overview looks to build the allow/deny trend and the
// "decisions today" tile. Not a server-side aggregate (none exists yet) -
// a bounded recent window, not "fetch everything and count in the
// browser" the way the log page is explicitly forbidden from doing.
const RECENT_LIMIT = 500;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export default function GovernanceOverviewPage() {
  const [health, setHealth] = useState<GovernanceHealth | null>(null);
  const [recent, setRecent] = useState<BoundaryDecision[]>([]);
  const [openGrantCount, setOpenGrantCount] = useState<number | null>(null);
  const [gaps, setGaps] = useState<GovernanceGaps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, decisionsRes, grantsRes, gapsRes] = await Promise.all([
        api.governanceHealth(),
        api.governanceDecisions({ limit: RECENT_LIMIT }),
        api.governanceGrants({ open: true, limit: 500 }),
        api.governanceGaps(),
      ]);
      setHealth(healthRes);
      setRecent(decisionsRes.decisions);
      setOpenGrantCount(grantsRes.grants.length);
      setGaps(gapsRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load governance overview');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const allowCount = useMemo(() => recent.filter((d) => d.verdict === 'allow').length, [recent]);
  const denyCount = useMemo(() => recent.filter((d) => d.verdict === 'deny').length, [recent]);

  const trend = useMemo(() => {
    const byDay = new Map<string, { date: string; allow: number; deny: number }>();
    for (const d of recent) {
      const key = dayKey(d.occurred_at);
      const row = byDay.get(key) ?? { date: key, allow: 0, deny: 0 };
      if (d.verdict === 'allow') row.allow += 1;
      else row.deny += 1;
      byDay.set(key, row);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [recent]);

  return (
    <>
      <TopBar title="Governance" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <GovernanceNav />
        {loading ? <LoadingState label="Loading governance overview" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading && !error ? (
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={`Decisions (last ${recent.length})`}
                value={`${allowCount} allow / ${denyCount} deny`}
              />
              <StatCard
                label="Open grants"
                value={openGrantCount === null ? '--' : `${openGrantCount}${openGrantCount >= 500 ? '+' : ''}`}
              />
              <StatCard
                label="Live policy digests"
                value={health?.policy.digests.length ?? 0}
                hint={health?.policy.lastSuccessfulReloadAt ? new Date(health.policy.lastSuccessfulReloadAt).toLocaleString() : undefined}
              />
              <StatCard
                label="Evidence health"
                value={health ? `queue ${health.evidence.queueDepth} · lag ${health.evidence.drainLagMs ?? 0}ms` : '--'}
                tone={health && health.evidence.droppedDueToFullBufferTotal > 0 ? 'danger' : 'default'}
                hint={health ? `${health.evidence.decisionsWrittenTotal} decisions written` : undefined}
              />
            </div>

            <div className="panel px-5 py-4">
              <h2 className="mb-4 text-sm font-semibold text-ink">Decision volume, allow vs deny</h2>
              {trend.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend}>
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
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--color-panel)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="allow" stackId="v" fill="var(--color-ok)" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="deny" stackId="v" fill="var(--color-danger)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState message="No decisions recorded yet." />
              )}
            </div>

            {gaps && (gaps.decisionsWithoutGrantsCount > 0 || gaps.grantsWithoutObservationsCount > 0) ? (
              <div className="panel border-warn/30 bg-warn-soft px-5 py-4 text-sm text-warn">
                <p className="font-medium">Linkage gaps (findings, not necessarily bugs):</p>
                <ul className="mt-2 list-inside list-disc">
                  {gaps.decisionsWithoutGrantsCount > 0 ? (
                    <li>{gaps.decisionsWithoutGrantsCount} grant-eligible decisions never opened a grant</li>
                  ) : null}
                  {gaps.grantsWithoutObservationsCount > 0 ? (
                    <li>{gaps.grantsWithoutObservationsCount} grants have zero observations</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </main>
    </>
  );
}
