'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { RepoSecurityOverview } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatCard } from '@/components/StatCard';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';
import { RepoSecurityNav } from '@/components/repository-security/RepoSecurityNav';
import { sanitizeRepoSecurityValue } from '@/lib/sanitize-repo-security';

export default function RepositorySecurityOverviewPage() {
  const [overview, setOverview] = useState<RepoSecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.repositorySecurityOverview();
      setOverview(sanitizeRepoSecurityValue(res.overview) as RepoSecurityOverview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load repository security');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <TopBar title="Repository Security" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <RepoSecurityNav />
        {loading ? <LoadingState label="Loading repository security" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error && overview ? (
          overview.repositories_protected === 0 ? (
            <EmptyState message="No repositories connected yet. Deliver a redacted local scan to Scout to populate this view." />
          ) : (
            <div className="flex flex-col gap-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Repositories protected"
                  value={overview.repositories_protected}
                />
                <StatCard
                  label="Open critical / high"
                  value={overview.open_critical_high ?? 0}
                  tone={(overview.open_critical_high ?? 0) > 0 ? 'danger' : 'default'}
                />
                <StatCard
                  label="Overdue remediation"
                  value={overview.overdue_remediation ?? 0}
                  hint={`Threshold ${overview.overdue_days ?? 14} days`}
                  tone={(overview.overdue_remediation ?? 0) > 0 ? 'danger' : 'default'}
                />
                <StatCard
                  label="Hook coverage"
                  value={`${overview.hook_coverage?.hooks_installed ?? 0}/${overview.hook_coverage?.connectors_reporting ?? 0}`}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <StatCard
                  label="Last successful scan"
                  value={
                    overview.last_successful_scan_at
                      ? new Date(overview.last_successful_scan_at).toLocaleString()
                      : 'None'
                  }
                />
                <StatCard label="Failed scans" value={overview.failed_scans ?? 0} />
                <StatCard
                  label="Pending local scan requests"
                  value={overview.pending_scan_requests ?? 0}
                  hint="Requests only; Scout does not run workstation commands"
                />
              </div>
              <div className="panel p-5 text-sm text-ink-muted">
                <p>
                  Trend: {overview.trend?.direction ?? 'stable'} (delta{' '}
                  {overview.trend?.open_delta ?? 0}). Open findings total:{' '}
                  {overview.open_findings?.open_total ?? 0}.
                </p>
                <Link
                  href="/dashboard/repository-security/repositories"
                  className="mt-3 inline-block text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Browse repositories
                </Link>
              </div>
            </div>
          )
        ) : null}
      </main>
    </>
  );
}
