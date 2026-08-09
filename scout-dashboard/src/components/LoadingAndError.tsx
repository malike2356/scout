export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-ink-muted">
      <span className="h-3 w-3 animate-pulse rounded-full bg-accent" />
      {label}...
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel flex flex-col gap-3 border-danger/30 bg-danger-soft px-5 py-4 text-sm text-danger">
      <span>{message}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="w-fit rounded-sm border border-danger/40 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="panel flex items-center justify-center px-5 py-10 text-sm text-ink-faint">
      {message}
    </div>
  );
}
