export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'accent' | 'danger';
}) {
  const valueClass =
    tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : 'text-ink';

  return (
    <div className="panel flex flex-col gap-1 px-5 py-4">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <span className={`text-3xl font-semibold tabular-nums ${valueClass}`}>{value}</span>
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
}
