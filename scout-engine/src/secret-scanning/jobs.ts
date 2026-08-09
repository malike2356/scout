// scout-engine/src/secret-scanning/jobs.ts
import { db } from '../db/index.js';
import { escalateOverdueFindings } from './alerts.js';
import type { TenantScope } from './service.js';

export async function runRetentionForScope(scope: TenantScope): Promise<{ deleted: number }> {
  const settings = await db('repo_secret_workspace_settings')
    .where({
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
    })
    .first();
  const retentionDays = Number(settings?.retention_days ?? 365);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffIso = cutoff.toISOString();

  const oldFindings = await db('repo_secret_findings')
    .where({
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
    })
    .andWhere((builder) => {
      builder.where('retain_until', '<', new Date().toISOString()).orWhere('last_seen_at', '<', cutoffIso);
    })
    .select('id', 'scout_finding_id');

  const findingIds = oldFindings.map((row) => row.id);
  if (findingIds.length) {
    await db('repo_secret_remediation_events')
      .where({ organization_id: scope.organizationId, workspace_id: scope.workspaceId })
      .whereIn('finding_id', findingIds)
      .del();
    await db('repo_secret_findings').whereIn('id', findingIds).del();
    const scoutIds = oldFindings
      .map((row) => row.scout_finding_id)
      .filter(Boolean) as string[];
    if (scoutIds.length) {
      await db('findings')
        .where({ organization_id: scope.organizationId, workspace_id: scope.workspaceId })
        .whereIn('id', scoutIds)
        .del();
    }
  }

  const oldScans = await db('repo_secret_scan_runs')
    .where({
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
    })
    .andWhere((builder) => {
      builder.where('retain_until', '<', new Date().toISOString()).orWhere('observed_at', '<', cutoffIso);
    })
    .del();

  await db('repo_secret_ingestion_receipts')
    .where({
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
    })
    .andWhere('created_at', '<', cutoffIso)
    .del();

  return { deleted: findingIds.length + Number(oldScans || 0) };
}

export async function offboardConnector(
  scope: TenantScope,
  connectorId: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db('repo_connectors')
    .where({
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
      id: connectorId,
    })
    .update({
      status: 'offboarded',
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .returning('*');
  if (!row) return null;

  await db('repo_secret_scan_requests')
    .where({
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
      connector_id: connectorId,
      status: 'requested',
    })
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    });

  return {
    id: row.id,
    connector_key: row.connector_key,
    repository_alias: row.repository_alias,
    status: row.status,
  };
}

export async function runSecretScanMaintenance(): Promise<void> {
  const workspaces = await db('workspaces').select('id', 'organization_id');
  for (const workspace of workspaces) {
    const scope = {
      organizationId: workspace.organization_id as string,
      workspaceId: workspace.id as string,
    };
    try {
      await escalateOverdueFindings(scope);
      await runRetentionForScope(scope);
    } catch (err) {
      console.warn(
        '[scout:secret-scan] maintenance failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }
}

let maintenanceTimer: NodeJS.Timeout | null = null;

export function startSecretScanMaintenanceJob(): void {
  if (maintenanceTimer) return;
  // Daily-ish cadence in long-running engine process.
  const intervalMs = 6 * 60 * 60 * 1000;
  maintenanceTimer = setInterval(() => {
    void runSecretScanMaintenance();
  }, intervalMs);
  void runSecretScanMaintenance();
}
