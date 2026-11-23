'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { BoundaryDecision, BoundaryGrant, GrantObservation, PolicyProvenanceEvent } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatCard } from '@/components/StatCard';
import { Badge } from '@/components/Badge';
import { ErrorState, LoadingState } from '@/components/LoadingAndError';
import { GovernanceNav } from '@/components/governance/GovernanceNav';
import { VerdictBadge } from '@/components/governance/VerdictBadge';
import { ResidualRisk } from '@/components/governance/ResidualRisk';

export default function GovernanceDecisionDetailPage() {
  const params = useParams<{ uid: string }>();
  const uid = params.uid;

  const [decision, setDecision] = useState<BoundaryDecision | null>(null);
  const [provenance, setProvenance] = useState<PolicyProvenanceEvent[]>([]);
  const [grants, setGrants] = useState<BoundaryGrant[]>([]);
  const [observations, setObservations] = useState<GrantObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [detail, activity] = await Promise.all([
        api.governanceDecision(uid),
        api.governanceDecisionActivity(uid),
      ]);
      setDecision(detail.decision);
      setProvenance(detail.provenance as PolicyProvenanceEvent[]);
      setGrants(activity.grants);
      setObservations(activity.observations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load decision');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  return (
    <>
      <TopBar title="Governance" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <GovernanceNav />
        {loading ? <LoadingState label="Loading decision" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading && !error && decision ? (
          <div className="flex flex-col gap-6">
            <div className="panel px-5 py-4">
              <div className="flex items-center gap-3">
                <VerdictBadge verdict={decision.verdict} />
                <h2 className="text-base font-semibold text-ink">{decision.rpc}</h2>
                {decision.phase ? <Badge tone="neutral">{decision.phase}</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-ink-muted">{decision.reason}</p>
              <ResidualRisk verdict={decision.verdict} residualRisk={decision.residual_risk} />

              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Policy" value={decision.policy_slug} hint={`v${decision.policy_version}`} />
                <StatCard
                  label="Authority"
                  value={decision.authority_kind}
                  hint={decision.authority_ref ?? undefined}
                />
                <StatCard label="Latency" value={decision.latency_us != null ? `${decision.latency_us}us` : '--'} />
                <StatCard label="Occurred" value={new Date(decision.occurred_at).toLocaleString()} />
              </div>
              <p className="mt-4 font-mono text-xs text-ink-faint break-all">
                digest: {decision.policy_digest}
              </p>
            </div>

            <div className="panel px-5 py-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Policy provenance chain</h2>
              {provenance.length === 0 ? (
                <p className="text-sm text-ink-faint">
                  No provenance entries - this decision cites authority_kind=&quot;{decision.authority_kind}&quot;
                  (no real policy was consulted, so there is nothing to chain).
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {provenance.map((event, idx) => (
                    <li key={idx} className="flex items-center gap-3 text-sm">
                      <Badge tone="accent">{event.event}</Badge>
                      <span className="text-ink-muted">{event.actor}</span>
                      <span className="text-ink-faint">({event.actor_kind})</span>
                      <span className="text-ink-faint">{new Date(event.occurred_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="panel px-5 py-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Activity under this decision</h2>
              {grants.length === 0 ? (
                <p className="text-sm text-ink-faint">
                  This decision did not open a boundary grant (only sandbox creation, provider
                  attachment, and service exposure do).
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {grants.map((grant) => (
                    <div key={grant.id} className="rounded-sm border border-base-border p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-ink">{grant.capability}</span>
                        <Badge tone={grant.effective_to ? 'neutral' : 'ok'}>
                          {grant.effective_to ? (grant.closed_reason ?? 'closed') : 'open'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-faint">
                        {new Date(grant.effective_from).toLocaleString()} →{' '}
                        {grant.effective_to ? new Date(grant.effective_to).toLocaleString() : 'still open'}
                      </p>
                      <ul className="mt-2 flex flex-col gap-1">
                        {observations
                          .filter((o) => o.grant_id === grant.id)
                          .map((o, idx) => (
                            <li key={idx} className="text-xs text-ink-muted">
                              {new Date(o.observed_at).toLocaleString()} · {o.kind} ·{' '}
                              {o.destination_host ?? '(no destination)'} ·{' '}
                              <Badge tone={o.outcome === 'succeeded' ? 'ok' : o.outcome === 'denied' ? 'danger' : 'warn'}>
                                {o.outcome}
                              </Badge>
                            </li>
                          ))}
                        {observations.filter((o) => o.grant_id === grant.id).length === 0 ? (
                          <li className="text-xs text-ink-faint">No observations recorded under this grant yet.</li>
                        ) : null}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
