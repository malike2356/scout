'use client';

import { useState } from 'react';

// The one typed-confirmation dialog in the governance surface (prompt 08's
// own rule: revoke needs a typed confirmation, not a click). It is also
// deliberately NOT optimistic - onConfirm's promise must resolve before
// this dialog reports anything to the caller, and a rejection surfaces the
// real error text rather than quietly closing as if it worked.
export function RevokeGrantDialog({
  sandboxId,
  onConfirm,
  onClose,
}: {
  sandboxId: string;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirmText.trim() === sandboxId;
  const canSubmit = matches && note.trim().length > 0 && !busy;

  async function handleConfirm() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(note.trim());
      onClose();
    } catch (err) {
      // Never close the dialog or imply success on failure - the operator
      // must see this exact message, not a generic "something went wrong".
      setError(err instanceof Error ? err.message : 'Failed to revoke this grant');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="panel w-full max-w-md border-danger/30 px-6 py-5">
        <h2 className="text-base font-semibold text-ink">Revoke grant: {sandboxId}</h2>
        <p className="mt-2 text-sm text-ink-muted">
          This closes Scout&apos;s record of this boundary immediately and writes an
          audit note. Scout has no live administrative connection to the gateway, so
          this does <strong>not</strong> also detach any capability at the platform -
          that still needs to be done there directly if it has not been already.
        </p>
        <label className="mt-4 block text-xs font-medium text-ink-muted">
          Audit note (required)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Why is this being revoked?"
            className="mt-1 w-full rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-danger/60"
          />
        </label>
        <label className="mt-3 block text-xs font-medium text-ink-muted">
          Type the sandbox id to confirm
          <input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={sandboxId}
            className="mt-1 w-full rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-danger/60"
          />
        </label>
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
            disabled={!canSubmit}
            onClick={handleConfirm}
            className="rounded-sm bg-danger px-3 py-1.5 text-sm font-medium text-base disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Revoking...' : 'Revoke grant'}
          </button>
        </div>
      </div>
    </div>
  );
}
