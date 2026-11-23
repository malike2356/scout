import { Badge } from '@/components/Badge';
import type { GovernanceVerdict } from '@/lib/types';

export function VerdictBadge({ verdict }: { verdict: GovernanceVerdict | string }) {
  return <Badge tone={verdict === 'allow' ? 'ok' : 'danger'}>{verdict}</Badge>;
}
