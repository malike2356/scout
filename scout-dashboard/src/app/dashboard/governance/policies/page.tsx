'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { PolicyProvenanceChain } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { Badge } from '@/components/Badge';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';
import { GovernanceNav } from '@/components/governance/GovernanceNav';

export default function GovernancePoliciesPage() {
  const [policies, setPolicies] = useState<PolicyProvenanceChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.governancePolicies();
      setPolicies(res.policies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load policy provenance');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <TopBar title="Governance" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <GovernanceNav />
        {loading ? <LoadingState label="Loading policy provenance" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error ? (
          policies.length === 0 ? (
            <EmptyState message="No policy has produced a decision yet." />
          ) : (
            <div className="flex flex-col gap-4">
              {policies.map((policy) => {
                const latest = policy.events[policy.events.length - 1];
                const isSuperseded = policy.events.some((e) => e.event === 'superseded' || e.event === 'revoked');
                return (
                  <div key={policy.policyDigest} className="panel px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-ink">
                          {policy.policySlug ?? 'unknown'} {policy.version != null ? `v${policy.version}` : ''}
                        </h2>
                        <p className="mt-1 font-mono text-xs text-ink-faint break-all">{policy.policyDigest}</p>
                      </div>
                      <Badge tone={isSuperseded ? 'neutral' : 'ok'}>{isSuperseded ? 'superseded' : 'active'}</Badge>
                    </div>
                    <ol className="mt-4 flex flex-wrap gap-2">
                      {policy.events.map((event, idx) => (
                        <li key={idx} className="flex items-center gap-2 rounded-sm border border-base-border px-2 py-1 text-xs">
                          <Badge tone="accent">{event.event}</Badge>
                          <span className="text-ink-muted">{event.actor}</span>
                          <span className="text-ink-faint">{new Date(event.occurred_at).toLocaleDateString()}</span>
                        </li>
                      ))}
                    </ol>
                    {latest?.signature_subject ? (
                      <p className="mt-2 text-xs text-ink-faint">Signed by: {latest.signature_subject}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </main>
    </>
  );
}
