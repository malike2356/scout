'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { RepoSecuritySettings } from '@/lib/types';
import { TopBar } from '@/components/TopBar';
import { StatusBadge } from '@/components/Badge';
import { ErrorState, LoadingState } from '@/components/LoadingAndError';
import { RepoSecurityNav } from '@/components/repository-security/RepoSecurityNav';

export default function RepositorySecuritySettingsPage() {
  const [settings, setSettings] = useState<RepoSecuritySettings | null>(null);
  const [connectors, setConnectors] = useState<
    Array<{ id: string; repository_alias: string; status: string; connector_key: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.repositorySecuritySettings();
      setSettings(res.settings);
      setConnectors(res.connectors || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.updateRepositorySecuritySettings(settings);
      setSettings(res.settings);
      setMessage('Settings saved.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function revoke(id: string) {
    setMessage(null);
    try {
      await api.revokeRepositoryConnector(id);
      setMessage('Connector revoked.');
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Revoke failed');
    }
  }

  async function offboard(id: string) {
    setMessage(null);
    try {
      await api.offboardRepositoryConnector(id);
      setMessage('Connector offboarded; pending scan requests cancelled.');
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Offboard failed');
    }
  }

  async function exportFindings() {
    setMessage(null);
    try {
      const payload = await api.exportRepositorySecurityFindings();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'scout-repository-security-export.json';
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('Redacted export downloaded.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Export failed');
    }
  }

  return (
    <>
      <TopBar title="Repository Security settings" />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <RepoSecurityNav />
        {loading ? <LoadingState label="Loading settings" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error && settings ? (
          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <form onSubmit={save} className="panel flex flex-col gap-4 p-5">
              <h2 className="text-sm font-semibold">Policies</h2>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted">Retention days</span>
                <input
                  type="number"
                  min={30}
                  max={2555}
                  value={settings.retention_days}
                  onChange={(e) =>
                    setSettings({ ...settings, retention_days: Number(e.target.value) })
                  }
                  className="rounded-sm border border-base-border bg-base px-3 py-2 outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted">Overdue threshold (days)</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={settings.overdue_days}
                  onChange={(e) =>
                    setSettings({ ...settings, overdue_days: Number(e.target.value) })
                  }
                  className="rounded-sm border border-base-border bg-base px-3 py-2 outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted">Path display</span>
                <select
                  value={settings.path_display_policy}
                  onChange={(e) =>
                    setSettings({ ...settings, path_display_policy: e.target.value })
                  }
                  className="rounded-sm border border-base-border bg-base px-3 py-2 outline-none focus:border-accent"
                >
                  <option value="relative">repository-relative</option>
                  <option value="basename">basename only</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted">Commit display</span>
                <select
                  value={settings.commit_display_policy}
                  onChange={(e) =>
                    setSettings({ ...settings, commit_display_policy: e.target.value })
                  }
                  className="rounded-sm border border-base-border bg-base px-3 py-2 outline-none focus:border-accent"
                >
                  <option value="allow">allow commit ids</option>
                  <option value="omit">omit commit ids</option>
                </select>
              </label>
              <fieldset className="grid gap-2">
                <legend className="text-sm text-ink-muted">Severity routing</legend>
                {(['critical', 'high', 'medium', 'low', 'info'] as const).map((sev) => (
                  <label key={sev} className="flex items-center justify-between gap-3 text-sm">
                    <span>{sev}</span>
                    <select
                      value={settings.severity_routing?.[sev] || 'digest'}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          severity_routing: {
                            ...settings.severity_routing,
                            [sev]: e.target.value,
                          },
                        })
                      }
                      className="rounded-sm border border-base-border bg-base px-3 py-1.5 outline-none focus:border-accent"
                    >
                      <option value="immediate">immediate</option>
                      <option value="digest">digest</option>
                    </select>
                  </label>
                ))}
              </fieldset>
              {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="self-start rounded-sm bg-accent px-4 py-2 text-sm font-medium text-base disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save settings'}
                </button>
                <button
                  type="button"
                  onClick={exportFindings}
                  className="rounded-sm border border-base-border px-4 py-2 text-sm text-ink hover:bg-base-panel2"
                >
                  Download redacted export
                </button>
              </div>
            </form>

            <div className="panel overflow-hidden">
              <h2 className="border-b border-base-border px-4 py-3 text-sm font-semibold">
                Connector revocation
              </h2>
              <ul className="divide-y divide-base-border">
                {connectors.map((connector) => (
                  <li
                    key={connector.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">{connector.repository_alias}</div>
                      <div className="text-xs text-ink-faint">{connector.connector_key}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={connector.status} />
                      {connector.status === 'active' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => revoke(connector.id)}
                            className="rounded-sm border border-danger/40 px-3 py-1.5 text-danger hover:bg-danger-soft"
                          >
                            Revoke
                          </button>
                          <button
                            type="button"
                            onClick={() => offboard(connector.id)}
                            className="rounded-sm border border-base-border px-3 py-1.5 text-ink-muted hover:bg-base-panel2"
                          >
                            Offboard
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
