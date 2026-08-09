type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok border-ok/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  neutral: 'bg-base-panel2 text-ink-muted border-base-border',
  accent: 'bg-accent-soft text-accent border-accent/30',
};

function toneForStatus(status?: string): Tone {
  const s = (status || '').toLowerCase();
  if (
    ['active', 'online', 'resolved', 'ok', 'healthy', 'completed', 'installed'].includes(s)
  ) {
    return 'ok';
  }
  if (
    [
      'idle',
      'acknowledged',
      'medium',
      'warning',
      'partial',
      'rotation-in-progress',
      'verification-pending',
      'requested',
    ].includes(s)
  ) {
    return 'warn';
  }
  if (
    [
      'suspended',
      'killed',
      'offline',
      'critical',
      'high',
      'open',
      'failed',
      'revoked',
      'rotation-required',
    ].includes(s)
  ) {
    return 'danger';
  }
  if (['low', 'info', 'accepted-risk', 'false-positive', 'omit'].includes(s)) return 'neutral';
  return 'neutral';
}

export function StatusBadge({ status }: { status?: string }) {
  const tone = toneForStatus(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium capitalize ${TONE_CLASSES[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status || 'unknown'}
    </span>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
