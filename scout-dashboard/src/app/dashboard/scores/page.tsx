'use client';

import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '@/lib/api';
import type { ScoresData } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatCard } from '@/components/StatCard';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';

export default function ScoresPage() {
  const [data, setData] = useState<ScoresData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.scores();
      setData(res ?? {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load scores');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const trend = data?.trend ?? [];
  const categories = data?.categories ?? [];

  return (
    <>
      <TopBar title="Scores" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? <LoadingState label="Loading scores" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading && !error ? (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-4 gap-4">
              <StatCard label="Current security score" value={data?.current ?? '--'} tone="accent" />
            </div>

            <div className="panel px-5 py-4">
              <h2 className="mb-4 text-sm font-semibold text-ink">Trend</h2>
              {trend.length > 0 ? (
                <div className="h-72">
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
                      <Line type="monotone" dataKey="score" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState message="No score history yet." />
              )}
            </div>

            <div className="panel px-5 py-4">
              <h2 className="mb-4 text-sm font-semibold text-ink">Category breakdown</h2>
              {categories.length > 0 ? (
                <ul className="flex flex-col gap-3">
                  {categories.map((category) => (
                    <li key={category.category} className="flex items-center gap-4">
                      <span className="w-40 text-sm text-ink-muted">{category.category}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-base-panel2">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.max(0, Math.min(100, category.score))}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-sm tabular-nums text-ink">{category.score}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState message="No category breakdown yet." />
              )}
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
