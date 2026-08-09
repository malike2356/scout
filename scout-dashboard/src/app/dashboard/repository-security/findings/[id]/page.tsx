'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { RepoSecretFinding } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatusBadge } from '@/components/Badge';
import { ErrorState, LoadingState } from '@/components/LoadingAndError';
import { RepoSecurityNav } from '@/components/repository-security/RepoSecurityNav';
import { RemediationForm } from '@/components/repository-security/RemediationForm';
import { displayPath, sanitizeRepoSecurityValue } from '@/lib/sanitize-repo-security';

const ROTATION_CHECKLIST = [
  'Rotate the credential in the provider console (outside Scout).',
  'Update local secrets storage / environment configuration.',
  'Re-run a staged or current local scan and confirm the finding clears.',
  'Record verification evidence without pasting secret values.',
];

export default function FindingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [finding, setFinding] = useState<RepoSecretFinding | null>(null);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.repositoryFinding(id);
      const safe = sanitizeRepoSecurityValue(res) as typeof res;
      setFinding(safe.finding);
      setEvents(safe.remediation_events || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load finding');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when route id changes
  }, [id]);

  return (
    <>
      <TopBar title="Finding detail" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <RepoSecurityNav />
        {loading ? <LoadingState label="Loading finding" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error && finding ? (
          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <div className="flex flex-col gap-4">
              <div className="panel p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold">{finding.rule_id}</h1>
                  <StatusBadge status={finding.severity} />
                  <StatusBadge status={finding.remediation_status} />
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-faint">Location</dt>
                    <dd className="font-mono text-xs">
                      {displayPath(finding.relative_path)}
                      {finding.line ? `:${finding.line}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Commit</dt>
                    <dd className="font-mono text-xs">{finding.commit_id || 'omitted'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">First observed</dt>
                    <dd>
                      {finding.first_seen_at
                        ? new Date(finding.first_seen_at).toLocaleString()
                        : '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Last observed</dt>
                    <dd>
                      {finding.last_seen_at
                        ? new Date(finding.last_seen_at).toLocaleString()
                        : '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Owner</dt>
                    <dd>{finding.remediation_owner || 'unassigned'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Due</dt>
                    <dd>
                      {finding.due_at ? new Date(finding.due_at).toLocaleDateString() : '-'}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 text-sm text-ink-muted">
                  Fingerprint {finding.fingerprint.slice(0, 12)}… Copying never includes credential
                  values because Scout never receives them.
                </p>
                <Link
                  href={`/dashboard/repository-security/repositories/${finding.connector_id}`}
                  className="mt-3 inline-block text-sm text-accent hover:underline"
                >
                  Open repository
                </Link>
              </div>

              <div className="panel p-5">
                <h2 className="mb-2 text-sm font-semibold">Rotation checklist</h2>
                <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-muted">
                  {ROTATION_CHECKLIST.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </div>

              <div className="panel overflow-x-auto">
                <h2 className="border-b border-base-border px-4 py-3 text-sm font-semibold">
                  Audit history
                </h2>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase text-ink-faint">
                      <th className="px-4 py-2" scope="col">
                        When
                      </th>
                      <th className="px-4 py-2" scope="col">
                        Transition
                      </th>
                      <th className="px-4 py-2" scope="col">
                        Actor
                      </th>
                      <th className="px-4 py-2" scope="col">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={String(event.id)} className="border-t border-base-border/60">
                        <td className="px-4 py-2">
                          {event.created_at
                            ? new Date(String(event.created_at)).toLocaleString()
                            : '-'}
                        </td>
                        <td className="px-4 py-2">
                          {String(event.from_status)} → {String(event.to_status)}
                        </td>
                        <td className="px-4 py-2">{String(event.actor)}</td>
                        <td className="px-4 py-2 text-ink-muted">{String(event.reason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <RemediationForm
              findingId={finding.id}
              currentStatus={finding.remediation_status}
              onUpdated={load}
            />
          </div>
        ) : null}
      </main>
    </>
  );
}
