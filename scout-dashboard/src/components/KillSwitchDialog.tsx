'use client';

import { useState } from 'react';

export function KillSwitchDialog({
  agentName,
  title,
  description,
  confirmWord,
  confirmLabel,
  busyLabel,
  onConfirm,
  onClose,
}: {
  agentName: string;
  title?: string;
  description?: string;
  /** Text the operator must type to confirm. Defaults to agentName. */
  confirmWord?: string;
  confirmLabel?: string;
  busyLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expected = confirmWord ?? agentName;
  const matches = value.trim() === expected;

  async function handleConfirm() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger kill switch');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="panel w-full max-w-md border-danger/30 px-6 py-5">
        <h2 className="text-base font-semibold text-ink">{title ?? `Kill switch: ${agentName}`}</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {description ??
            'This immediately suspends the agent and blocks further tool calls. This action cannot be undone from here.'}{' '}
          Type <span className="font-mono text-ink">{expected}</span> below to confirm.
        </p>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason (optional, shown in the audit trail)"
          rows={2}
          className="mt-4 w-full resize-none rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-danger/60"
        />
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={expected}
          className="mt-2 w-full rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-danger/60"
        />
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-base-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!matches || busy}
            onClick={handleConfirm}
            className="rounded-sm bg-danger px-3 py-1.5 text-sm font-medium text-base disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (busyLabel ?? 'Killing...') : (confirmLabel ?? 'Kill agent')}
          </button>
        </div>
      </div>
    </div>
  );
}
