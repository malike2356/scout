'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { RepoSecretScanRun } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatusBadge } from '@/components/Badge';
import { ErrorState, LoadingState } from '@/components/LoadingAndError';
import { RepoSecurityNav } from '@/components/repository-security/RepoSecurityNav';
import { sanitizeRepoSecurityValue } from '@/lib/sanitize-repo-security';

export default function ScanDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [scan, setScan] = useState<RepoSecretScanRun | null>(null);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.repositoryScan(id);
      const safe = sanitizeRepoSecurityValue(res) as typeof res;
      setScan(safe.scan_run);
      setReceipt(safe.ingestion_receipt);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load scan');
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
      <TopBar title="Scan detail" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <RepoSecurityNav />
        {loading ? <LoadingState label="Loading scan" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error && scan ? (
          <div className="flex flex-col gap-6">
            <div className="panel p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold">Scan {scan.scan_id}</h1>
                <StatusBadge status={scan.status} />
                <StatusBadge status={scan.mode} />
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <dt className="text-ink-faint">Duration</dt>
                  <dd>
                    {scan.duration_ms != null ? `${Math.round(scan.duration_ms / 1000)}s` : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Scanner</dt>
                  <dd>
                    {scan.scanner_name} {scan.scanner_version}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Observed</dt>
                  <dd>
                    {scan.observed_at ? new Date(scan.observed_at).toLocaleString() : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Accepted / deduped</dt>
                  <dd>
                    {scan.findings_accepted ?? 0} / {scan.findings_deduped ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Safe retry</dt>
                  <dd>{scan.safe_retry ? 'yes (failed delivery)' : 'not required'}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Correlation</dt>
                  <dd className="font-mono text-xs">{scan.correlation_id || '-'}</dd>
                </div>
              </dl>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) => (
                  <div key={sev} className="rounded-sm border border-base-border px-3 py-2">
                    <div className="text-xs uppercase text-ink-faint">{sev}</div>
                    <div className="tabular-nums">{scan.counts?.[sev] ?? 0}</div>
                  </div>
                ))}
              </div>
              <Link
                href={`/dashboard/repository-security/repositories/${scan.connector_id}`}
                className="mt-4 inline-block text-sm text-accent hover:underline"
              >
                Back to repository
              </Link>
            </div>

            <div className="panel p-5 text-sm">
              <h2 className="mb-2 font-semibold">Ingestion receipt</h2>
              {receipt ? (
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-faint">Outcome</dt>
                    <dd>{String(receipt.outcome)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">HTTP status</dt>
                    <dd>{String(receipt.http_status)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Correlation</dt>
                    <dd className="font-mono text-xs">{String(receipt.correlation_id)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Created</dt>
                    <dd>
                      {receipt.created_at
                        ? new Date(String(receipt.created_at)).toLocaleString()
                        : '-'}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-ink-muted">No receipt metadata available.</p>
              )}
              <p className="mt-3 text-ink-muted">
                Request bodies and matched content are never stored or displayed.
              </p>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
