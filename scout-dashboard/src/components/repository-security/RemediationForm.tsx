'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { RemediationStatus } from '@/lib/types';

const STATUSES: RemediationStatus[] = [
  'open',
  'acknowledged',
  'rotation-required',
  'rotation-in-progress',
  'verification-pending',
  'resolved',
  'accepted-risk',
  'false-positive',
];

const CONSEQUENTIAL = new Set([
  'resolved',
  'accepted-risk',
  'false-positive',
  'rotation-required',
]);

export function RemediationForm({
  findingId,
  currentStatus,
  onUpdated,
}: {
  findingId: string;
  currentStatus: string;
  onUpdated: () => void;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [owner, setOwner] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (CONSEQUENTIAL.has(status) && !reason.trim()) {
      setError('Reason is required for this transition.');
      return;
    }
    if (status === 'resolved' && !evidence.trim()) {
      setError('Resolution evidence is required (no credential values).');
      return;
    }
    if ((status === 'accepted-risk' || status === 'false-positive') && !expiresAt) {
      setError('Expiry date is required for accepted risk and false positive.');
      return;
    }

    setSaving(true);
    try {
      await api.transitionRepositoryFinding(findingId, {
        status,
        reason: reason.trim() || 'status update',
        evidence_note: evidence.trim() || undefined,
        remediation_owner: owner.trim() || undefined,
        due_at: dueAt || undefined,
        accepted_risk_expires_at: expiresAt || undefined,
      });
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remediation update failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel flex flex-col gap-3 p-5">
      <h2 className="text-sm font-semibold text-ink">Update remediation</h2>
      <p className="text-xs text-ink-muted">
        Rotate and verify credentials only on the workstation or provider console. Scout never
        stores secret values.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-muted">Status</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-sm border border-base-border bg-base px-3 py-2 text-ink outline-none focus:border-accent"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-muted">Reason</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="rounded-sm border border-base-border bg-base px-3 py-2 text-ink outline-none focus:border-accent"
          required={CONSEQUENTIAL.has(status)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-muted">Evidence note (no secrets)</span>
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          rows={2}
          className="rounded-sm border border-base-border bg-base px-3 py-2 text-ink outline-none focus:border-accent"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-muted">Owner</span>
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="rounded-sm border border-base-border bg-base px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-muted">Due date</span>
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-sm border border-base-border bg-base px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-ink-muted">Accepted risk / FP expiry</span>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-sm border border-base-border bg-base px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button
        type="submit"
        disabled={saving}
        className="self-start rounded-sm bg-accent px-4 py-2 text-sm font-medium text-base disabled:opacity-60"
      >
        {saving ? 'Saving...' : 'Save transition'}
      </button>
    </form>
  );
}
