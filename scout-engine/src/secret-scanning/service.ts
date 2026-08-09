// scout-engine/src/secret-scanning/service.ts
import { db } from '../db/index.js';
import {
  REMEDIATION_STATUSES,
  SECRET_SCAN_POSTURE_SCHEMA_VERSION,
  type RemediationStatus,
} from './constants.js';

export interface TenantScope {
  organizationId: string;
  workspaceId: string;
}

function scopeWhere(scope: TenantScope) {
  return {
    organization_id: scope.organizationId,
    workspace_id: scope.workspaceId,
  };
}

function publicFinding(row: Record<string, unknown>) {
  return {
    id: row.id,
    connector_id: row.connector_id,
    fingerprint: row.fingerprint,
    rule_id: row.rule_id,
    severity: row.severity,
    relative_path: row.relative_path,
    line: row.line_number,
    commit_id: row.commit_id,
    remediation_status: row.remediation_status,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    seen_count: row.seen_count,
    remediation_owner: row.remediation_owner,
    due_at: row.due_at,
    accepted_risk_expires_at: row.accepted_risk_expires_at,
    scout_finding_id: row.scout_finding_id,
  };
}

function publicScan(row: Record<string, unknown>) {
  return {
    id: row.id,
    connector_id: row.connector_id,
    scan_id: row.client_scan_id,
    mode: row.mode,
    scanner_name: row.scanner_name,
    scanner_version: row.scanner_version,
    status: row.status,
    started_at: row.started_at,
    completed_at: row.completed_at,
    observed_at: row.observed_at,
    counts: {
      critical: row.count_critical,
      high: row.count_high,
      medium: row.count_medium,
      low: row.count_low,
      info: row.count_info,
    },
    findings_accepted: row.findings_accepted,
    findings_deduped: row.findings_deduped,
    hook_installed: row.hook_installed,
    hook_last_check_at: row.hook_last_check_at,
    environment_policy_ok: row.environment_policy_ok,
    environment_policy_detail: row.environment_policy_detail,
    correlation_id: row.correlation_id,
  };
}

function publicConnector(row: Record<string, unknown>) {
  return {
    id: row.id,
    connector_key: row.connector_key,
    repository_alias: row.repository_alias,
    product: row.product,
    status: row.status,
    last_ingest_at: row.last_ingest_at,
    created_at: row.created_at,
  };
}

export async function listConnectors(scope: TenantScope) {
  const rows = await db('repo_connectors')
    .where(scopeWhere(scope))
    .orderBy('repository_alias', 'asc');
  return rows.map((row) => publicConnector(row as Record<string, unknown>));
}

export async function getConnector(scope: TenantScope, id: string) {
  const row = await db('repo_connectors').where({ ...scopeWhere(scope), id }).first();
  return row ? publicConnector(row as Record<string, unknown>) : null;
}

export async function listScanRuns(
  scope: TenantScope,
  options: { connectorId?: string; limit: number; offset: number },
) {
  let query = db('repo_secret_scan_runs').where(scopeWhere(scope));
  if (options.connectorId) query = query.where('connector_id', options.connectorId);
  const totalRow = await query.clone().count('* as count').first();
  const rows = await query
    .orderBy('observed_at', 'desc')
    .limit(options.limit)
    .offset(options.offset);
  return {
    scan_runs: rows.map((row) => publicScan(row as Record<string, unknown>)),
    total: parseInt(String(totalRow?.count ?? 0), 10),
    limit: options.limit,
    offset: options.offset,
  };
}

export async function getScanRun(scope: TenantScope, id: string) {
  const row = await db('repo_secret_scan_runs').where({ ...scopeWhere(scope), id }).first();
  return row ? publicScan(row as Record<string, unknown>) : null;
}

export async function listFindings(
  scope: TenantScope,
  options: {
    connectorId?: string;
    status?: string;
    severity?: string;
    limit: number;
    offset: number;
  },
) {
  let query = db('repo_secret_findings').where(scopeWhere(scope));
  if (options.connectorId) query = query.where('connector_id', options.connectorId);
  if (options.status && options.status !== 'all') {
    query = query.where('remediation_status', options.status);
  }
  if (options.severity) query = query.where('severity', options.severity);

  const totalRow = await query.clone().count('* as count').first();
  const rows = await query
    .orderBy('last_seen_at', 'desc')
    .limit(options.limit)
    .offset(options.offset);
  return {
    findings: rows.map((row) => publicFinding(row as Record<string, unknown>)),
    total: parseInt(String(totalRow?.count ?? 0), 10),
    limit: options.limit,
    offset: options.offset,
  };
}

export async function getFinding(scope: TenantScope, id: string) {
  const row = await db('repo_secret_findings').where({ ...scopeWhere(scope), id }).first();
  if (!row) return null;
  const events = await db('repo_secret_remediation_events')
    .where({ ...scopeWhere(scope), finding_id: id })
    .orderBy('created_at', 'desc')
    .limit(100);
  return {
    finding: publicFinding(row as Record<string, unknown>),
    remediation_events: events.map((event) => ({
      id: event.id,
      from_status: event.from_status,
      to_status: event.to_status,
      actor: event.actor,
      reason: event.reason,
      evidence_note: event.evidence_note,
      created_at: event.created_at,
    })),
  };
}

const CONSEQUENTIAL = new Set<RemediationStatus>([
  'resolved',
  'accepted-risk',
  'false-positive',
  'rotation-required',
]);

export async function transitionRemediation(params: {
  scope: TenantScope;
  findingId: string;
  toStatus: string;
  actor: string;
  reason: string;
  evidenceNote?: string;
  dueAt?: string;
  acceptedRiskExpiresAt?: string;
  remediationOwner?: string;
  correlationId: string;
}): Promise<
  | { ok: true; finding: ReturnType<typeof publicFinding> }
  | { ok: false; status: number; code: string }
> {
  if (!(REMEDIATION_STATUSES as readonly string[]).includes(params.toStatus)) {
    return { ok: false, status: 400, code: 'invalid_status' };
  }
  const toStatus = params.toStatus as RemediationStatus;
  if (!params.actor.trim() || !params.reason.trim()) {
    return { ok: false, status: 400, code: 'actor_reason_required' };
  }
  if (CONSEQUENTIAL.has(toStatus) && toStatus !== 'rotation-required' && !params.reason.trim()) {
    return { ok: false, status: 400, code: 'actor_reason_required' };
  }
  if (toStatus === 'resolved' && !(params.evidenceNote || '').trim()) {
    return { ok: false, status: 400, code: 'resolution_evidence_required' };
  }
  if (
    (toStatus === 'accepted-risk' || toStatus === 'false-positive') &&
    !params.acceptedRiskExpiresAt
  ) {
    return { ok: false, status: 400, code: 'expiry_required' };
  }

  const finding = await db('repo_secret_findings')
    .where({ ...scopeWhere(params.scope), id: params.findingId })
    .first();
  if (!finding) return { ok: false, status: 404, code: 'not_found' };

  const fromStatus = finding.remediation_status as string;
  const updates: Record<string, unknown> = {
    remediation_status: toStatus,
    updated_at: new Date().toISOString(),
  };
  if (params.dueAt) updates.due_at = params.dueAt;
  if (params.remediationOwner) updates.remediation_owner = params.remediationOwner;
  if (params.acceptedRiskExpiresAt) {
    updates.accepted_risk_expires_at = params.acceptedRiskExpiresAt;
  }
  if (toStatus === 'resolved') {
    updates.resolution_evidence = params.evidenceNote;
  }

  const [updated] = await db('repo_secret_findings')
    .where({ id: finding.id })
    .update(updates)
    .returning('*');

  await db('repo_secret_remediation_events').insert({
    organization_id: params.scope.organizationId,
    workspace_id: params.scope.workspaceId,
    finding_id: finding.id,
    from_status: fromStatus,
    to_status: toStatus,
    actor: params.actor.trim(),
    reason: params.reason.trim(),
    evidence_note: params.evidenceNote?.trim() || null,
    correlation_id: params.correlationId,
  });

  if (finding.scout_finding_id) {
    const mirrorStatus =
      toStatus === 'resolved'
        ? 'remediated'
        : toStatus === 'false-positive'
          ? 'false_positive'
          : toStatus === 'accepted-risk'
            ? 'wont_fix'
            : 'open';
    const mirrorUpdates: Record<string, unknown> = { status: mirrorStatus };
    if (['remediated', 'false_positive', 'wont_fix'].includes(mirrorStatus)) {
      mirrorUpdates.resolved_at = new Date().toISOString();
    } else {
      mirrorUpdates.resolved_at = null;
      mirrorUpdates.resolved_by = null;
    }
    await db('findings')
      .where({
        id: finding.scout_finding_id,
        organization_id: params.scope.organizationId,
        workspace_id: params.scope.workspaceId,
      })
      .update(mirrorUpdates);
  }

  return { ok: true, finding: publicFinding(updated as Record<string, unknown>) };
}

export async function getAggregatePosture(scope: TenantScope) {
  const connectors = await db('repo_connectors').where(scopeWhere(scope)).where({ status: 'active' });
  const openFindings = await db('repo_secret_findings')
    .where(scopeWhere(scope))
    .whereNotIn('remediation_status', ['resolved', 'accepted-risk', 'false-positive']);

  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, open_total: 0 };
  for (const finding of openFindings) {
    const severity = finding.severity as keyof typeof counts;
    if (severity in counts && severity !== 'open_total') {
      counts[severity] += 1;
    }
    counts.open_total += 1;
  }

  const lastScan = await db('repo_secret_scan_runs')
    .where(scopeWhere(scope))
    .orderBy('observed_at', 'desc')
    .first();

  const hookRows = await db('repo_secret_scan_runs')
    .where(scopeWhere(scope))
    .whereNotNull('hook_installed')
    .orderBy('observed_at', 'desc')
    .limit(200);

  const latestHookByConnector = new Map<string, boolean>();
  for (const row of hookRows) {
    const key = String(row.connector_id);
    if (!latestHookByConnector.has(key)) {
      latestHookByConnector.set(key, Boolean(row.hook_installed));
    }
  }
  const hookCovered = [...latestHookByConnector.values()].filter(Boolean).length;

  const openNow = counts.open_total;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const acceptedWeekAgo = await db('repo_secret_findings')
    .where(scopeWhere(scope))
    .where('first_seen_at', '<=', weekAgo.toISOString())
    .whereNotIn('remediation_status', ['resolved', 'accepted-risk', 'false-positive'])
    .count('* as count')
    .first();
  const priorOpen = parseInt(String(acceptedWeekAgo?.count ?? openNow), 10);
  const openDelta = openNow - priorOpen;

  const resolvedEvents = await db('repo_secret_remediation_events')
    .where(scopeWhere(scope))
    .where({ to_status: 'resolved' })
    .orderBy('created_at', 'desc')
    .limit(200);
  const durations: number[] = [];
  for (const event of resolvedEvents) {
    const finding = await db('repo_secret_findings').where({ id: event.finding_id }).first();
    if (!finding?.first_seen_at || !event.created_at) continue;
    const ms =
      new Date(String(event.created_at)).getTime() -
      new Date(String(finding.first_seen_at)).getTime();
    if (ms >= 0) durations.push(ms);
  }
  durations.sort((a, b) => a - b);
  const medianMs = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const p95Ms = durations.length
    ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
    : null;

  return {
    schema_version: SECRET_SCAN_POSTURE_SCHEMA_VERSION,
    repositories_protected: connectors.length,
    open_findings: counts,
    last_successful_scan_at: lastScan?.status === 'failed' ? null : lastScan?.observed_at ?? null,
    hook_coverage: {
      connectors_reporting: latestHookByConnector.size,
      hooks_installed: hookCovered,
    },
    trend: {
      direction: openDelta > 0 ? ('up' as const) : openDelta < 0 ? ('down' as const) : ('stable' as const),
      open_delta: openDelta,
    },
    remediation_time: {
      sample_size: durations.length,
      median_hours: medianMs == null ? null : Math.round((medianMs / 3_600_000) * 10) / 10,
      p95_hours: p95Ms == null ? null : Math.round((p95Ms / 3_600_000) * 10) / 10,
    },
    deep_links: {
      dashboard_path: '/dashboard/repository-security',
    },
  };
}

export async function getDashboardOverview(scope: TenantScope) {
  const posture = await getAggregatePosture(scope);
  const settings = await getOrCreateSettings(scope);
  const overdueCutoff = new Date();
  overdueCutoff.setDate(overdueCutoff.getDate() - settings.overdue_days);

  const overdueRow = await db('repo_secret_findings')
    .where(scopeWhere(scope))
    .whereNotIn('remediation_status', ['resolved', 'accepted-risk', 'false-positive'])
    .andWhere((builder) => {
      builder
        .where('due_at', '<', new Date().toISOString())
        .orWhere((inner) => {
          inner.whereNull('due_at').andWhere('first_seen_at', '<', overdueCutoff.toISOString());
        });
    })
    .count('* as count')
    .first();

  const failedScans = await db('repo_secret_scan_runs')
    .where(scopeWhere(scope))
    .where({ status: 'failed' })
    .count('* as count')
    .first();

  const openCritical = await db('repo_secret_findings')
    .where(scopeWhere(scope))
    .whereNotIn('remediation_status', ['resolved', 'accepted-risk', 'false-positive'])
    .whereIn('severity', ['critical', 'high'])
    .count('* as count')
    .first();

  const pendingRequests = await db('repo_secret_scan_requests')
    .where(scopeWhere(scope))
    .where({ status: 'requested' })
    .count('* as count')
    .first();

  return {
    ...posture,
    open_critical_high: parseInt(String(openCritical?.count ?? 0), 10),
    overdue_remediation: parseInt(String(overdueRow?.count ?? 0), 10),
    failed_scans: parseInt(String(failedScans?.count ?? 0), 10),
    pending_scan_requests: parseInt(String(pendingRequests?.count ?? 0), 10),
    overdue_days: settings.overdue_days,
  };
}

export async function listRepositorySummaries(scope: TenantScope) {
  const connectors = await db('repo_connectors')
    .where(scopeWhere(scope))
    .orderBy('repository_alias', 'asc');

  const summaries = [];
  for (const connector of connectors) {
    const openCounts = await db('repo_secret_findings')
      .where({
        ...scopeWhere(scope),
        connector_id: connector.id,
      })
      .whereNotIn('remediation_status', ['resolved', 'accepted-risk', 'false-positive'])
      .select('severity')
      .count('* as count')
      .groupBy('severity');

    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, open_total: 0 };
    for (const row of openCounts) {
      const severity = String(row.severity) as keyof typeof counts;
      if (severity in counts && severity !== 'open_total') {
        counts[severity] = parseInt(String(row.count), 10);
        counts.open_total += counts[severity];
      }
    }

    const latestByMode: Record<string, Record<string, unknown> | null> = {
      current: null,
      staged: null,
      history: null,
      environment: null,
    };
    for (const mode of Object.keys(latestByMode)) {
      const scan = await db('repo_secret_scan_runs')
        .where({
          ...scopeWhere(scope),
          connector_id: connector.id,
          mode,
        })
        .orderBy('observed_at', 'desc')
        .first();
      latestByMode[mode] = scan
        ? {
            status: scan.status,
            observed_at: scan.observed_at,
            scanner_version: scan.scanner_version,
          }
        : null;
    }

    const latestAny = await db('repo_secret_scan_runs')
      .where({ ...scopeWhere(scope), connector_id: connector.id })
      .orderBy('observed_at', 'desc')
      .first();

    summaries.push({
      ...publicConnector(connector as Record<string, unknown>),
      path_display_policy: connector.path_display_policy,
      commit_display_policy: connector.commit_display_policy,
      retention_days: connector.retention_days,
      open_counts: counts,
      scan_modes: latestByMode,
      last_success_at:
        latestAny && latestAny.status !== 'failed' ? latestAny.observed_at : null,
      hook_installed: latestAny?.hook_installed ?? null,
      hook_last_check_at: latestAny?.hook_last_check_at ?? null,
    });
  }

  return summaries;
}

export async function getRepositoryDetail(scope: TenantScope, connectorId: string) {
  const connector = await db('repo_connectors')
    .where({ ...scopeWhere(scope), id: connectorId })
    .first();
  if (!connector) return null;

  const scans = await listScanRuns(scope, { connectorId, limit: 25, offset: 0 });
  const findings = await listFindings(scope, {
    connectorId,
    status: 'all',
    limit: 50,
    offset: 0,
  });
  const requests = await db('repo_secret_scan_requests')
    .where({ ...scopeWhere(scope), connector_id: connectorId })
    .orderBy('created_at', 'desc')
    .limit(20);

  const latest = await db('repo_secret_scan_runs')
    .where({ ...scopeWhere(scope), connector_id: connectorId })
    .orderBy('observed_at', 'desc')
    .first();

  return {
    connector: {
      ...publicConnector(connector as Record<string, unknown>),
      path_display_policy: connector.path_display_policy,
      commit_display_policy: connector.commit_display_policy,
      retention_days: connector.retention_days,
    },
    latest_scan: latest ? publicScan(latest as Record<string, unknown>) : null,
    scan_runs: scans.scan_runs,
    findings: findings.findings,
    scan_requests: requests.map((row) => ({
      id: row.id,
      mode: row.mode,
      status: row.status,
      requested_by: row.requested_by,
      note: row.note,
      created_at: row.created_at,
      expires_at: row.expires_at,
    })),
  };
}

export async function getScanRunDetail(scope: TenantScope, id: string) {
  const scan = await getScanRun(scope, id);
  if (!scan) return null;

  const receipt = await db('repo_secret_ingestion_receipts')
    .where(scopeWhere(scope))
    .where({ client_scan_id: (scan as { scan_id?: string }).scan_id })
    .orderBy('created_at', 'desc')
    .first();

  const started = Date.parse(String((scan as { started_at?: string }).started_at ?? ''));
  const completed = Date.parse(String((scan as { completed_at?: string }).completed_at ?? ''));
  const durationMs =
    Number.isFinite(started) && Number.isFinite(completed) ? Math.max(completed - started, 0) : null;

  return {
    scan_run: {
      ...scan,
      duration_ms: durationMs,
      warnings: [],
      safe_retry: (scan as { status?: string }).status === 'failed',
    },
    ingestion_receipt: receipt
      ? {
          id: receipt.id,
          outcome: receipt.outcome,
          http_status: receipt.http_status,
          correlation_id: receipt.correlation_id,
          findings_accepted: receipt.findings_accepted,
          findings_deduped: receipt.findings_deduped,
          created_at: receipt.created_at,
          // Never include request bodies.
        }
      : null,
  };
}

const DEFAULT_SEVERITY_ROUTING = {
  critical: 'immediate',
  high: 'immediate',
  medium: 'digest',
  low: 'digest',
  info: 'digest',
};

export async function exportRedactedFindings(scope: TenantScope) {
  const { assertNoProhibitedExport, displaySafePath, stripForbiddenFields } = await import(
    './redact.js'
  );
  const settings = await getOrCreateSettings(scope);
  const connectors = await db('repo_connectors').where(scopeWhere(scope));
  const byId = new Map(connectors.map((c) => [c.id as string, c]));
  const findings = await db('repo_secret_findings')
    .where(scopeWhere(scope))
    .orderBy('last_seen_at', 'desc')
    .limit(5000);

  const rows = findings.map((row) => {
    const connector = byId.get(row.connector_id as string);
    return stripForbiddenFields({
      id: row.id,
      repository_alias: connector?.repository_alias ?? null,
      rule_id: row.rule_id,
      severity: row.severity,
      relative_path: displaySafePath(
        row.relative_path as string | null,
        settings.path_display_policy,
      ),
      line: row.line_number,
      commit_id: settings.commit_display_policy === 'omit' ? null : row.commit_id,
      remediation_status: row.remediation_status,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
    });
  });

  const payload = {
    schema_version: SECRET_SCAN_POSTURE_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    findings: rows,
  };
  assertNoProhibitedExport(payload);
  return payload;
}

export async function getOrCreateSettings(scope: TenantScope) {
  const existing = await db('repo_secret_workspace_settings').where(scopeWhere(scope)).first();
  if (existing) {
    return {
      retention_days: existing.retention_days as number,
      overdue_days: existing.overdue_days as number,
      severity_routing:
        typeof existing.severity_routing === 'string'
          ? JSON.parse(existing.severity_routing)
          : existing.severity_routing,
      path_display_policy: existing.path_display_policy as string,
      commit_display_policy: existing.commit_display_policy as string,
    };
  }

  const [created] = await db('repo_secret_workspace_settings')
    .insert({
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
      severity_routing: JSON.stringify(DEFAULT_SEVERITY_ROUTING),
    })
    .returning('*');

  return {
    retention_days: created.retention_days as number,
    overdue_days: created.overdue_days as number,
    severity_routing: DEFAULT_SEVERITY_ROUTING,
    path_display_policy: created.path_display_policy as string,
    commit_display_policy: created.commit_display_policy as string,
  };
}

export async function updateSettings(
  scope: TenantScope,
  patch: {
    retention_days?: number;
    overdue_days?: number;
    severity_routing?: Record<string, string>;
    path_display_policy?: string;
    commit_display_policy?: string;
  },
) {
  await getOrCreateSettings(scope);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.retention_days != null) updates.retention_days = patch.retention_days;
  if (patch.overdue_days != null) updates.overdue_days = patch.overdue_days;
  if (patch.severity_routing) updates.severity_routing = JSON.stringify(patch.severity_routing);
  if (patch.path_display_policy) updates.path_display_policy = patch.path_display_policy;
  if (patch.commit_display_policy) updates.commit_display_policy = patch.commit_display_policy;

  await db('repo_secret_workspace_settings').where(scopeWhere(scope)).update(updates);

  if (patch.path_display_policy || patch.commit_display_policy || patch.retention_days != null) {
    const connectorUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.path_display_policy) connectorUpdates.path_display_policy = patch.path_display_policy;
    if (patch.commit_display_policy) {
      connectorUpdates.commit_display_policy = patch.commit_display_policy;
    }
    if (patch.retention_days != null) connectorUpdates.retention_days = patch.retention_days;
    await db('repo_connectors').where(scopeWhere(scope)).update(connectorUpdates);
  }

  return getOrCreateSettings(scope);
}

export async function revokeConnector(scope: TenantScope, connectorId: string) {
  const [row] = await db('repo_connectors')
    .where({ ...scopeWhere(scope), id: connectorId })
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .returning('*');
  return row ? publicConnector(row as Record<string, unknown>) : null;
}

export async function createScanRequest(params: {
  scope: TenantScope;
  connectorId: string;
  mode: string;
  requestedBy: string;
  note?: string;
}) {
  const connector = await db('repo_connectors')
    .where({ ...scopeWhere(params.scope), id: params.connectorId, status: 'active' })
    .first();
  if (!connector) return { ok: false as const, status: 404, code: 'not_found' };
  if (!['current', 'staged', 'history', 'environment'].includes(params.mode)) {
    return { ok: false as const, status: 400, code: 'invalid_mode' };
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  const [row] = await db('repo_secret_scan_requests')
    .insert({
      organization_id: params.scope.organizationId,
      workspace_id: params.scope.workspaceId,
      connector_id: params.connectorId,
      mode: params.mode,
      status: 'requested',
      requested_by: params.requestedBy,
      note: params.note ?? null,
      expires_at: expires.toISOString(),
    })
    .returning('*');

  return {
    ok: true as const,
    request: {
      id: row.id,
      connector_id: row.connector_id,
      mode: row.mode,
      status: row.status,
      requested_by: row.requested_by,
      note: row.note,
      created_at: row.created_at,
      expires_at: row.expires_at,
      // Local poller only; Scout does not execute workstation commands.
      execution: 'local_opt_in_only',
    },
  };
}

export async function listPendingScanRequestsByConnectorKey(
  scope: TenantScope,
  connectorKey: string,
) {
  const connector = await db('repo_connectors')
    .where({
      ...scopeWhere(scope),
      connector_key: connectorKey,
      status: 'active',
    })
    .first();
  if (!connector) return null;

  const rows = await db('repo_secret_scan_requests')
    .where({
      ...scopeWhere(scope),
      connector_id: connector.id,
      status: 'requested',
    })
    .orderBy('created_at', 'asc')
    .limit(50);

  return {
    connector_id: connector.id as string,
    requests: rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      status: row.status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      // Narrow contract: no repository roots, secrets, or command payloads.
      execution: 'local_opt_in_only',
    })),
  };
}

export async function acknowledgeScanRequest(
  scope: TenantScope,
  connectorKey: string,
  requestId: string,
) {
  const connector = await db('repo_connectors')
    .where({
      ...scopeWhere(scope),
      connector_key: connectorKey,
      status: 'active',
    })
    .first();
  if (!connector) return { ok: false as const, status: 404, code: 'not_found' };

  const [row] = await db('repo_secret_scan_requests')
    .where({
      ...scopeWhere(scope),
      connector_id: connector.id,
      id: requestId,
      status: 'requested',
    })
    .update({
      status: 'acknowledged',
      updated_at: new Date().toISOString(),
    })
    .returning(['id', 'status', 'mode']);

  if (!row) return { ok: false as const, status: 404, code: 'not_found' };
  return { ok: true as const, request: row };
}
