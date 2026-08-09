'use client';

import { useState } from 'react';

export function KillSwitchDialog({
  agentName,
  onConfirm,
  onClose,
}: {
  agentName: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = value.trim() === agentName;

  async function handleConfirm() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
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
        <h2 className="text-base font-semibold text-ink">Kill switch: {agentName}</h2>
        <p className="mt-2 text-sm text-ink-muted">
          This immediately suspends the agent and blocks further tool calls. This action cannot be
          undone from here. Type the agent name below to confirm.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={agentName}
          className="mt-4 w-full rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-danger/60"
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
            {busy ? 'Killing...' : 'Kill agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
