'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, unwrapList } from '@/lib/api';
import type { Agent } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatusBadge } from '@/components/Badge';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.agents();
      setAgents(unwrapList<Agent>(res));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <TopBar title="Agents" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? <LoadingState label="Loading agents" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading && !error ? (
          agents.length > 0 ? (
            <div className="panel overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-base-border text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-5 py-3 font-medium">Name</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Score</th>
                    <th className="px-5 py-3 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.id} className="border-b border-base-border last:border-0 hover:bg-base-panel2">
                      <td className="px-5 py-3">
                        <Link href={`/dashboard/agents/${agent.id}`} className="font-medium text-ink hover:text-accent">
                          {agent.name ?? agent.id}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={agent.status} />
                      </td>
                      <td className="px-5 py-3 tabular-nums text-ink-muted">{agent.score ?? '--'}</td>
                      <td className="px-5 py-3 text-ink-muted">
                        {agent.last_seen_at ? new Date(agent.last_seen_at).toLocaleString() : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No agents registered yet. Follow the onboarding guide to connect your first agent." />
          )
        ) : null}
      </main>
    </>
  );
}
