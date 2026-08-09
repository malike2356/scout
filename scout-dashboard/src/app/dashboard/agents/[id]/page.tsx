'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { Agent } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatusBadge } from '@/components/Badge';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';
import { KillSwitchDialog } from '@/components/KillSwitchDialog';

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentId = params?.id;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showKillSwitch, setShowKillSwitch] = useState(false);

  async function load() {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.agent(agentId);
      setAgent(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load agent');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const isDisabled = agent?.status === 'killed' || agent?.status === 'suspended';

  return (
    <>
      <TopBar title={agent?.name ?? 'Agent'} />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <button
          type="button"
          onClick={() => router.push('/dashboard/agents')}
          className="mb-4 text-sm text-ink-muted hover:text-ink"
        >
          Back to agents
        </button>

        {loading ? <LoadingState label="Loading agent" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading && !error && agent ? (
          <div className="flex flex-col gap-6">
            <div className="panel flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-4">
                <div>
                  <h2 className="text-base font-semibold text-ink">{agent.name ?? agent.id}</h2>
                  <p className="text-xs text-ink-faint">ID: {agent.id}</p>
                </div>
                <StatusBadge status={agent.status} />
              </div>
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => setShowKillSwitch(true)}
                className="rounded-sm border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isDisabled ? 'Agent disabled' : 'Kill switch'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="panel px-5 py-4">
                <h3 className="mb-3 text-sm font-semibold text-ink">Tools</h3>
                {agent.tools && agent.tools.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {agent.tools.map((tool) => (
                      <li
                        key={tool}
                        className="rounded-sm border border-base-border bg-base-panel2 px-2 py-1 font-mono text-xs text-ink-muted"
                      >
                        {tool}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState message="No tool inventory reported yet." />
                )}
              </div>

              <div className="panel px-5 py-4">
                <h3 className="mb-3 text-sm font-semibold text-ink">Details</h3>
                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-faint">Score</dt>
                    <dd className="text-ink">{agent.score ?? '--'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-faint">Last seen</dt>
                    <dd className="text-ink">
                      {agent.last_seen_at ? new Date(agent.last_seen_at).toLocaleString() : '--'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-faint">Registered</dt>
                    <dd className="text-ink">
                      {agent.created_at ? new Date(agent.created_at).toLocaleString() : '--'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="panel px-5 py-4">
              <h3 className="mb-3 text-sm font-semibold text-ink">Event timeline</h3>
              {agent.events && agent.events.length > 0 ? (
                <ul className="flex flex-col divide-y divide-base-border">
                  {agent.events.map((event, index) => (
                    <li key={event.id ?? index} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="flex flex-col">
                        <span className="text-ink">{event.message ?? event.type ?? 'Event'}</span>
                        <span className="text-xs text-ink-faint">
                          {event.created_at ? new Date(event.created_at).toLocaleString() : ''}
                        </span>
                      </div>
                      {event.severity ? <StatusBadge status={event.severity} /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState message="No events recorded yet." />
              )}
            </div>
          </div>
        ) : null}

        {!loading && !error && !agent ? <EmptyState message="Agent not found." /> : null}
      </main>

      {showKillSwitch && agent ? (
        <KillSwitchDialog
          agentName={agent.name ?? agent.id}
          onClose={() => setShowKillSwitch(false)}
          onConfirm={async () => {
            await api.killswitch(agent.id);
            await load();
          }}
        />
      ) : null}
    </>
  );
}
