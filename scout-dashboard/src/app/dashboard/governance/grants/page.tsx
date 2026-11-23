'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { BoundaryGrant } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { Badge } from '@/components/Badge';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';
import { GovernanceNav } from '@/components/governance/GovernanceNav';
import { RevokeGrantDialog } from '@/components/governance/RevokeGrantDialog';

const PAGE_SIZE = 50;

export default function GovernanceGrantsPage() {
  const [rows, setRows] = useState<BoundaryGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [sandboxId, setSandboxId] = useState('');
  const [offset, setOffset] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<BoundaryGrant | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(currentOffset: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.governanceGrants({
        open: openOnly,
        sandboxId: sandboxId || undefined,
        limit: PAGE_SIZE,
        offset: currentOffset,
      });
      setRows(res.grants);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load grants');
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

  async function handleRevoke(note: string) {
    if (!revokeTarget) return;
    // Not optimistic: wait for the real response before changing anything
    // on screen. A failure here surfaces to the dialog, not to this list.
    const result = await api.revokeGovernanceGrant(revokeTarget.id, note);
    setNotice(
      result.ok
        ? `Grant for ${revokeTarget.sandbox_id} closed. Live capability detachment was not attempted - see the service note.`
        : 'Revoke did not complete.',
    );
    await load(offset);
  }

  return (
    <>
      <TopBar title="Governance" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <GovernanceNav />

        {notice ? (
          <div className="mb-4 panel border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">{notice}</div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
              className="accent-accent"
            />
            Open only
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Sandbox id
            <input
              value={sandboxId}
              onChange={(e) => setSandboxId(e.target.value)}
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

        {loading ? <LoadingState label="Loading grants" /> : null}
        {error ? <ErrorState message={error} onRetry={() => load(offset)} /> : null}
        {!loading && !error ? (
          rows.length === 0 ? (
            <EmptyState message="No grants match these filters." />
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-base-border text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3 font-medium" scope="col">Sandbox</th>
                    <th className="px-4 py-3 font-medium" scope="col">Capability</th>
                    <th className="px-4 py-3 font-medium" scope="col">Opened</th>
                    <th className="px-4 py-3 font-medium" scope="col">Status</th>
                    <th className="px-4 py-3 font-medium" scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((grant) => (
                    <tr key={grant.id} className="border-b border-base-border/60 hover:bg-base-panel2">
                      <td className="px-4 py-3 font-mono text-xs text-ink">{grant.sandbox_id}</td>
                      <td className="px-4 py-3 text-ink-muted">{grant.capability}</td>
                      <td className="px-4 py-3 text-ink-muted">{new Date(grant.effective_from).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <Badge tone={grant.effective_to ? 'neutral' : 'ok'}>
                          {grant.effective_to ? (grant.closed_reason ?? 'closed') : 'open'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {!grant.effective_to ? (
                          <button
                            type="button"
                            onClick={() => setRevokeTarget(grant)}
                            className="rounded-sm border border-danger/40 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                          >
                            Revoke
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        <div className="mt-4 flex justify-end gap-2 text-sm">
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

        {revokeTarget ? (
          <RevokeGrantDialog
            sandboxId={revokeTarget.sandbox_id}
            onConfirm={handleRevoke}
            onClose={() => setRevokeTarget(null)}
          />
        ) : null}
      </main>
    </>
  );
}
