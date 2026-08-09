// scout-engine/src/secret-scanning/alerts.ts
// Wire repository secret-scan events into the existing Scout alert/digest stack.
import { db } from '../db/index.js';
import { deliverAlert } from '../alerts/delivery.js';
import {
  getMatchingRules,
  partitionRulesByDelivery,
  shouldSuppressAlert,
  type AlertRule,
} from '../alerts/rules.js';
import { getOrCreateSettings, type TenantScope } from './service.js';
import { displaySafePath } from './redact.js';

export interface SecretAlertFinding {
  id: string;
  scoutFindingId: string | null;
  severity: string;
  ruleId: string;
  relativePath?: string | null;
  line?: number | null;
  isReopen: boolean;
}

function dashboardBase(): string {
  return (process.env.SCOUT_DASHBOARD_PUBLIC_URL || 'https://console.labyrinthscout.com').replace(
    /\/$/,
    '',
  );
}

export function buildRedactedSecretAlertPayload(params: {
  repositoryAlias: string;
  finding: SecretAlertFinding;
  pathPolicy?: string;
  observedAt?: string;
}): Record<string, unknown> {
  const deepLink = `${dashboardBase()}/dashboard/repository-security/findings/${params.finding.id}`;
  return {
    id: params.finding.scoutFindingId || params.finding.id,
    finding_type: 'exposed_secret',
    severity: params.finding.severity,
    title: `Repository secret (${params.finding.ruleId}) in ${params.repositoryAlias}`,
    description: [
      `Repository: ${params.repositoryAlias}`,
      `Rule: ${params.finding.ruleId}`,
      `Location: ${displaySafePath(params.finding.relativePath, params.pathPolicy)}${
        params.finding.line ? `:${params.finding.line}` : ''
      }`,
      params.finding.isReopen ? 'Event: finding reopened' : 'Event: new finding',
      `Dashboard: ${deepLink}`,
    ].join('\n'),
    tool_name: 'verlox-secrets',
    first_seen_at: params.observedAt || new Date().toISOString(),
    remediation:
      'Rotate the credential outside Scout, then update remediation status with evidence that contains no secret values.',
  };
}

async function deliverMatching(
  workspaceId: string,
  event: AlertRule['trigger']['event'],
  severity: string | undefined,
  data: { finding?: Record<string, unknown>; scanRun?: Record<string, unknown>; event?: string },
  findingId?: string,
): Promise<number> {
  const rules = await getMatchingRules(workspaceId, event, severity);
  const { instant } = partitionRulesByDelivery(rules);
  let delivered = 0;
  for (const rule of instant) {
    const check = await shouldSuppressAlert(workspaceId, rule.id, findingId);
    if (check.suppressed) continue;
    await deliverAlert(rule, data);
    delivered += 1;
  }
  return delivered;
}

export async function notifySecretFindingAccepted(params: {
  scope: TenantScope;
  repositoryAlias: string;
  pathPolicy?: string;
  finding: SecretAlertFinding;
}): Promise<{ delivered: number; routed: string }> {
  const settings = await getOrCreateSettings(params.scope);
  const routing =
    settings.severity_routing?.[params.finding.severity] ||
    (['critical', 'high'].includes(params.finding.severity) ? 'immediate' : 'digest');

  const redacted = buildRedactedSecretAlertPayload({
    repositoryAlias: params.repositoryAlias,
    finding: params.finding,
    pathPolicy: params.pathPolicy || settings.path_display_policy,
  });

  if (routing !== 'immediate') {
    return { delivered: 0, routed: 'digest' };
  }

  const delivered = await deliverMatching(
    params.scope.workspaceId,
    'finding_new',
    params.finding.severity,
    { finding: redacted, event: 'repository_secret_finding' },
    params.finding.scoutFindingId || params.finding.id,
  );
  return { delivered, routed: 'immediate' };
}

export async function notifySecretScanFailed(params: {
  scope: TenantScope;
  repositoryAlias: string;
  scanRunId: string;
  mode: string;
  status: string;
}): Promise<number> {
  if (params.status !== 'failed') return 0;
  const scanRun = {
    id: params.scanRunId,
    mode: params.mode,
    status: params.status,
    repository_alias: params.repositoryAlias,
    title: `Repository secret scan failed (${params.mode}) for ${params.repositoryAlias}`,
  };
  return deliverMatching(
    params.scope.workspaceId,
    'scan_failed',
    'high',
    {
      event: `Repository secret scan failed (${params.mode}) for ${params.repositoryAlias}`,
      scanRun,
      finding: {
        id: params.scanRunId,
        severity: 'high',
        title: scanRun.title,
        description: `Mode: ${params.mode}. Dashboard: ${dashboardBase()}/dashboard/repository-security/scans/${params.scanRunId}`,
        tool_name: 'verlox-secrets',
        first_seen_at: new Date().toISOString(),
      },
    },
    params.scanRunId,
  );
}

export async function escalateOverdueFindings(scope: TenantScope): Promise<number> {
  const settings = await getOrCreateSettings(scope);
  const overdueCutoff = new Date();
  overdueCutoff.setDate(overdueCutoff.getDate() - settings.overdue_days);

  const rows = await db('repo_secret_findings as f')
    .join('repo_connectors as c', 'c.id', 'f.connector_id')
    .where({
      'f.organization_id': scope.organizationId,
      'f.workspace_id': scope.workspaceId,
    })
    .whereIn('f.remediation_status', [
      'rotation-required',
      'rotation-in-progress',
      'verification-pending',
      'open',
      'acknowledged',
    ])
    .andWhere((builder) => {
      builder
        .where('f.due_at', '<', new Date().toISOString())
        .orWhere((inner) => {
          inner.whereNull('f.due_at').andWhere('f.first_seen_at', '<', overdueCutoff.toISOString());
        });
    })
    .select(
      'f.id',
      'f.scout_finding_id',
      'f.severity',
      'f.rule_id',
      'f.relative_path',
      'f.line_number',
      'f.remediation_status',
      'c.repository_alias',
      'c.path_display_policy',
    )
    .limit(100);

  let delivered = 0;
  for (const row of rows) {
    const redacted = buildRedactedSecretAlertPayload({
      repositoryAlias: String(row.repository_alias),
      pathPolicy: String(row.path_display_policy || settings.path_display_policy),
      finding: {
        id: String(row.id),
        scoutFindingId: row.scout_finding_id ? String(row.scout_finding_id) : null,
        severity: String(row.severity),
        ruleId: String(row.rule_id),
        relativePath: row.relative_path as string | null,
        line: row.line_number as number | null,
        isReopen: false,
      },
    });
    redacted.title = `Overdue remediation (${row.remediation_status}): ${redacted.title}`;
    delivered += await deliverMatching(
      scope.workspaceId,
      'finding_new',
      String(row.severity),
      { finding: redacted, event: 'repository_secret_overdue' },
      String(row.scout_finding_id || row.id),
    );
  }
  return delivered;
}
