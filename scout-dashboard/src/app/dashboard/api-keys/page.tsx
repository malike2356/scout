'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, unwrapList } from '@/lib/api';
import type { ApiKey } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { ErrorState, LoadingState, EmptyState } from '@/components/LoadingAndError';

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.apiKeys();
      setKeys(unwrapList<ApiKey>(res));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createApiKey(name.trim());
      setRevealedKey(created.key ?? created.secret ?? null);
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await api.deleteApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke API key');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <TopBar title="API Keys" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex flex-col gap-6">
          <form onSubmit={handleCreate} className="panel flex items-end gap-3 px-5 py-4">
            <label className="flex flex-1 flex-col gap-1.5 text-sm text-ink-muted">
              New key name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. production-agent"
                className="rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-base transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create key'}
            </button>
          </form>

          {revealedKey ? (
            <div className="panel border-accent/30 bg-accent-soft px-5 py-4">
              <p className="text-sm font-medium text-ink">
                Copy this key now. You will not be able to see it again.
              </p>
              <code className="mt-2 block break-all rounded-sm bg-base px-3 py-2 font-mono text-sm text-accent">
                {revealedKey}
              </code>
              <button
                type="button"
                onClick={() => setRevealedKey(null)}
                className="mt-3 text-xs text-ink-muted hover:text-ink"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {error ? <ErrorState message={error} onRetry={load} /> : null}
          {loading ? <LoadingState label="Loading API keys" /> : null}

          {!loading ? (
            keys.length > 0 ? (
              <div className="panel overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-base-border text-xs uppercase tracking-wide text-ink-faint">
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Prefix</th>
                      <th className="px-5 py-3 font-medium">Created</th>
                      <th className="px-5 py-3 font-medium">Last used</th>
                      <th className="px-5 py-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key.id} className="border-b border-base-border last:border-0 hover:bg-base-panel2">
                        <td className="px-5 py-3 text-ink">{key.name ?? 'Unnamed key'}</td>
                        <td className="px-5 py-3 font-mono text-ink-muted">
                          {(key.key_prefix ?? key.prefix ?? '****') + '...'}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {key.created_at ? new Date(key.created_at).toLocaleDateString() : '--'}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleRevoke(key.id)}
                            disabled={revokingId === key.id}
                            className="rounded-sm border border-danger/40 px-3 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
                          >
                            {revokingId === key.id ? 'Revoking...' : 'Revoke'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState message="No API keys yet. Create one to connect your first agent." />
            )
          ) : null}
        </div>
      </main>
    </>
  );
}
