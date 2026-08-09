'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { RepoSecretFinding, RepoSecretScanRun, RepositorySummary } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatusBadge } from '@/components/Badge';
import { ErrorState, LoadingState } from '@/components/LoadingAndError';
import { RepoSecurityNav } from '@/components/repository-security/RepoSecurityNav';
import { displayPath, sanitizeRepoSecurityValue } from '@/lib/sanitize-repo-security';

export default function RepositoryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [connector, setConnector] = useState<RepositorySummary | null>(null);
  const [latest, setLatest] = useState<RepoSecretScanRun | null>(null);
  const [scans, setScans] = useState<RepoSecretScanRun[]>([]);
  const [findings, setFindings] = useState<RepoSecretFinding[]>([]);
  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [mode, setMode] = useState('current');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.repositoryConnector(id);
      const safe = sanitizeRepoSecurityValue(res) as typeof res;
      setConnector(safe.connector);
      setLatest(safe.latest_scan);
      setScans(safe.scan_runs || []);
      setFindings(safe.findings || []);
      setRequests(safe.scan_requests || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load repository');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when route id changes
  }, [id]);

  async function requestScan() {
    setMessage(null);
    try {
      await api.requestRepositoryScan(id, { mode });
      setMessage(
        'Scan requested. A local opt-in poller may pick this up; Scout does not execute remote commands.',
      );
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Request failed');
    }
  }

  return (
    <>
      <TopBar title="Repository detail" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <RepoSecurityNav />
        <Link
          href="/dashboard/repository-security/repositories"
          className="mb-4 inline-block text-sm text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Back to repositories
        </Link>
        {loading ? <LoadingState label="Loading repository" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error && connector ? (
          <div className="flex flex-col gap-6">
            <div className="panel flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold text-ink">{connector.repository_alias}</h1>
                  <p className="text-sm text-ink-muted">
                    {connector.product || 'product unset'} · {connector.connector_key}
                  </p>
                </div>
                <StatusBadge status={connector.status} />
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <dt className="text-ink-faint">Scanner</dt>
                  <dd>
                    {latest
                      ? `${latest.scanner_name} ${latest.scanner_version}`
                      : 'No scans yet'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Hook health</dt>
                  <dd>
                    {latest?.hook_installed == null
                      ? 'unknown'
                      : latest.hook_installed
                        ? 'installed'
                        : 'missing'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Environment policy</dt>
                  <dd>
                    {latest?.environment_policy_ok == null
                      ? 'n/a'
                      : latest.environment_policy_ok
                        ? 'ok'
                        : latest.environment_policy_detail || 'failed'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Delivery</dt>
                  <dd>{latest?.status || 'no delivery yet'}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-end gap-3 border-t border-base-border pt-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink-muted">Request local scan mode</span>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    className="rounded-sm border border-base-border bg-base px-3 py-2 outline-none focus:border-accent"
                  >
                    {['current', 'staged', 'history', 'environment'].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={requestScan}
                  className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-base"
                >
                  Request scan
                </button>
                {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
              </div>
            </div>

            <section className="panel overflow-x-auto">
              <h2 className="border-b border-base-border px-4 py-3 text-sm font-semibold">
                Scan timeline
              </h2>
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase text-ink-faint">
                    <th className="px-4 py-2" scope="col">
                      Observed
                    </th>
                    <th className="px-4 py-2" scope="col">
                      Mode
                    </th>
                    <th className="px-4 py-2" scope="col">
                      Status
                    </th>
                    <th className="px-4 py-2" scope="col">
                      Findings
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((scan) => (
                    <tr key={scan.id} className="border-t border-base-border/60">
                      <td className="px-4 py-2">
                        <Link
                          href={`/dashboard/repository-security/scans/${scan.id}`}
                          className="text-accent hover:underline"
                        >
                          {scan.observed_at
                            ? new Date(scan.observed_at).toLocaleString()
                            : scan.id}
                        </Link>
                      </td>
                      <td className="px-4 py-2">{scan.mode}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={scan.status} />
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {(scan.counts?.critical ?? 0) +
                          (scan.counts?.high ?? 0) +
                          (scan.counts?.medium ?? 0) +
                          (scan.counts?.low ?? 0) +
                          (scan.counts?.info ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel overflow-x-auto">
              <h2 className="border-b border-base-border px-4 py-3 text-sm font-semibold">
                Findings
              </h2>
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase text-ink-faint">
                    <th className="px-4 py-2" scope="col">
                      Rule
                    </th>
                    <th className="px-4 py-2" scope="col">
                      Location
                    </th>
                    <th className="px-4 py-2" scope="col">
                      Severity
                    </th>
                    <th className="px-4 py-2" scope="col">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((finding) => (
                    <tr key={finding.id} className="border-t border-base-border/60">
                      <td className="px-4 py-2">
                        <Link
                          href={`/dashboard/repository-security/findings/${finding.id}`}
                          className="text-accent hover:underline"
                        >
                          {finding.rule_id}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {displayPath(
                          finding.relative_path,
                          connector.path_display_policy || 'relative',
                        )}
                        {finding.line ? `:${finding.line}` : ''}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={finding.severity} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={finding.remediation_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="panel p-5 text-sm text-ink-muted">
              <h2 className="mb-2 font-semibold text-ink">Scan requests</h2>
              {requests.length === 0 ? (
                <p>No pending or recent requests.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  {requests.map((req) => (
                    <li key={String(req.id)}>
                      {String(req.mode)} · {String(req.status)} ·{' '}
                      {req.created_at
                        ? new Date(String(req.created_at)).toLocaleString()
                        : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </>
  );
}
