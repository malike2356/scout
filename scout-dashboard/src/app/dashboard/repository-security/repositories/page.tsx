'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { RepositorySummary } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatusBadge } from '@/components/Badge';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';
import { RepoSecurityNav } from '@/components/repository-security/RepoSecurityNav';
import { sanitizeRepoSecurityValue } from '@/lib/sanitize-repo-security';

export default function RepositoriesPage() {
  const [rows, setRows] = useState<RepositorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [product, setProduct] = useState('all');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.repositoryConnectors();
      setRows(
        (sanitizeRepoSecurityValue(res.repositories) as RepositorySummary[]) ?? [],
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load repositories');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const products = useMemo(() => {
    const set = new Set(rows.map((r) => r.product).filter(Boolean) as string[]);
    return ['all', ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const statusOk = status === 'all' || row.status === status;
      const productOk = product === 'all' || row.product === product;
      return statusOk && productOk;
    });
  }, [rows, status, product]);

  return (
    <>
      <TopBar title="Repository Security" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <RepoSecurityNav />
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-ink outline-none focus:border-accent"
            >
              {['all', 'active', 'revoked', 'offboarded'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Product
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-ink outline-none focus:border-accent"
            >
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? <LoadingState label="Loading repositories" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error ? (
          filtered.length === 0 ? (
            <EmptyState message="No repositories match these filters." />
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-base-border text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3 font-medium" scope="col">
                      Repository
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Product
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Connector
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Scans
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Hook
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Open
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Last success
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id} className="border-b border-base-border/60 hover:bg-base-panel2">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/repository-security/repositories/${row.id}`}
                          className="font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          {row.repository_alias}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{row.product || '-'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-muted">
                        {['current', 'history', 'environment']
                          .map((mode) => `${mode}:${row.scan_modes?.[mode]?.status || 'n/a'}`)
                          .join(' · ')}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={
                            row.hook_installed == null
                              ? 'unknown'
                              : row.hook_installed
                                ? 'installed'
                                : 'missing'
                          }
                        />
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {row.open_counts?.open_total ?? 0}
                        <span className="ml-1 text-xs text-ink-faint">
                          (C{row.open_counts?.critical ?? 0}/H{row.open_counts?.high ?? 0})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {row.last_success_at
                          ? new Date(row.last_success_at).toLocaleString()
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </main>
    </>
  );
}
