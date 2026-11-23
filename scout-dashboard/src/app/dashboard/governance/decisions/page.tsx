'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { BoundaryDecision } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';
import { GovernanceNav } from '@/components/governance/GovernanceNav';
import { VerdictBadge } from '@/components/governance/VerdictBadge';

const PAGE_SIZE = 50;

export default function GovernanceDecisionsPage() {
  const [rows, setRows] = useState<BoundaryDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  // Every one of these is a real server-side filter forwarded to
  // GET /evidence/decisions - the list below is never fetched in full and
  // then filtered in the browser.
  const [verdict, setVerdict] = useState('');
  const [rpc, setRpc] = useState('');
  const [subject, setSubject] = useState('');

  async function load(currentOffset: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.governanceDecisions({
        verdict: verdict || undefined,
        rpc: rpc || undefined,
        subject: subject || undefined,
        limit: PAGE_SIZE,
        offset: currentOffset,
      });
      setRows(res.decisions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load decisions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  function applyFilters() {
    setOffset(0);
    load(0);
  }

  return (
    <>
      <TopBar title="Governance" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <GovernanceNav />

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Verdict
            <select
              value={verdict}
              onChange={(e) => setVerdict(e.target.value)}
              className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-ink outline-none focus:border-accent"
            >
              <option value="">all</option>
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            RPC
            <input
              value={rpc}
              onChange={(e) => setRpc(e.target.value)}
              placeholder="e.g. CreateSandbox, HttpRequest"
              className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Subject (sandbox id)
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-base hover:bg-accent-hover"
          >
            Apply
          </button>
        </div>

        {loading ? <LoadingState label="Loading decisions" /> : null}
        {error ? <ErrorState message={error} onRetry={() => load(offset)} /> : null}
        {!loading && !error ? (
          rows.length === 0 ? (
            <EmptyState message="No decisions match these filters." />
          ) : (
            <>
              <div className="panel overflow-x-auto">
                <table className="w-full min-w-[840px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-base-border text-xs uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-3 font-medium" scope="col">Time</th>
                      <th className="px-4 py-3 font-medium" scope="col">Subject</th>
                      <th className="px-4 py-3 font-medium" scope="col">RPC</th>
                      <th className="px-4 py-3 font-medium" scope="col">Verdict</th>
                      <th className="px-4 py-3 font-medium" scope="col">Reason</th>
                      <th className="px-4 py-3 font-medium" scope="col">Policy digest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.decision_uid} className="border-b border-base-border/60 hover:bg-base-panel2">
                        <td className="px-4 py-3 whitespace-nowrap text-ink-muted">
                          {new Date(row.occurred_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">
                          {row.sandbox_id || row.workspace_id || row.tenant_id}
                        </td>
                        <td className="px-4 py-3 text-ink">{row.rpc}</td>
                        <td className="px-4 py-3">
                          <VerdictBadge verdict={row.verdict} />
                        </td>
                        <td className="px-4 py-3 max-w-xs truncate text-ink-muted" title={row.reason}>
                          {row.reason}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/governance/decisions/${row.decision_uid}`}
                            className="font-mono text-xs text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          >
                            {row.policy_digest.slice(0, 12)}...
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
                <span>
                  Showing {offset + 1}-{offset + rows.length}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    className="rounded-sm border border-base-border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={rows.length < PAGE_SIZE}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    className="rounded-sm border border-base-border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )
        ) : null}
      </main>
    </>
  );
}
