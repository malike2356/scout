'use client';

import { useAuth } from '@/lib/auth';
import { planLabel } from '@/lib/plans';

export function TopBar({ title }: { title: string }) {
  const { organization, logout } = useAuth();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-base-border bg-base px-8">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      <div className="flex items-center gap-4">
        {organization ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="text-ink">{organization.name}</span>
            <span className="rounded-sm border border-base-border bg-base-panel px-2 py-0.5 text-xs uppercase tracking-wide text-accent">
              {planLabel(organization.plan)}
            </span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={logout}
          className="rounded-sm border border-base-border px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-danger/40 hover:text-danger"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
