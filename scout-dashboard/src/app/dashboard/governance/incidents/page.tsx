'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { BoundaryGrant } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { ErrorState, EmptyState } from '@/components/LoadingAndError';
import { GovernanceNav } from '@/components/governance/GovernanceNav';

function defaultFrom(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 16);
}

export default function GovernanceIncidentsPage() {
  const [host, setHost] = useState('');
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grants, setGrants] = useState<BoundaryGrant[] | null>(null);
  const [permittingDecisions, setPermittingDecisions] = useState<string[]>([]);

  async function runLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!host.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.governanceInverse({
        host: host.trim(),
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      setGrants(res.grants);
      setPermittingDecisions(res.permittingDecisions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to run the inverse lookup');
      setGrants(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <TopBar title="Governance" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <GovernanceNav />

        <div className="panel mb-6 px-5 py-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">
            Incident lookup: this host was contacted - which boundary let it happen?
          </h2>
          <form onSubmit={runLookup} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-ink-muted">
              Destination host
              <input
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="example.com"
                className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-muted">
              From
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-muted">
              To
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-sm border border-base-border bg-base-panel px-3 py-1.5 text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-base hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </form>
        </div>

        {error ? <ErrorState message={error} /> : null}

        {grants ? (
          grants.length === 0 ? (
            <EmptyState message="No grant permitted a call to this host in this window." />
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead>
                  <tr className="border-b border-base-border text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3 font-medium" scope="col">Sandbox</th>
                    <th className="px-4 py-3 font-medium" scope="col">Capability</th>
                    <th className="px-4 py-3 font-medium" scope="col">Window</th>
                    <th className="px-4 py-3 font-medium" scope="col">Permitting decision</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.map((grant) => (
                    <tr key={grant.id} className="border-b border-base-border/60 hover:bg-base-panel2">
                      <td className="px-4 py-3 font-mono text-xs text-ink">{grant.sandbox_id}</td>
                      <td className="px-4 py-3 text-ink-muted">{grant.capability}</td>
                      <td className="px-4 py-3 text-ink-muted">
                        {new Date(grant.effective_from).toLocaleString()} →{' '}
                        {grant.effective_to ? new Date(grant.effective_to).toLocaleString() : 'still open'}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/governance/decisions/${grant.decision_uid}`}
                          className="font-mono text-xs text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          {grant.decision_uid.slice(0, 12)}...
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-base-border px-4 py-3 text-xs text-ink-faint">
                {permittingDecisions.length} distinct permitting decision(s) across {grants.length} grant(s).
              </p>
            </div>
          )
        ) : null}
      </main>
    </>
  );
}
