// scout-engine/src/secret-scanning/ingest.ts
import { db } from '../db/index.js';
import { MAX_INGEST_BYTES } from './constants.js';
import type { SecretScanIngestPayload } from './schema.js';
import { validateSecretScanIngest } from './schema.js';
import { verifyIngestSignature } from './signature.js';
import { notifySecretFindingAccepted, notifySecretScanFailed } from './alerts.js';

export interface IngestContext {
  organizationId: string;
  workspaceId: string;
  apiKey: string;
  correlationId: string;
  requestByteLength: number;
}

export type IngestResult =
  | {
      ok: true;
      status: 201 | 200;
      duplicate: boolean;
      scanRunId: string;
      connectorId: string;
      findingsAccepted: number;
      findingsDeduped: number;
      correlationId: string;
    }
  | {
      ok: false;
      status: number;
      code: string;
      correlationId: string;
    };

async function writeReceipt(params: {
  organizationId: string;
  workspaceId: string;
  connectorId?: string | null;
  idempotencyKey?: string | null;
  clientScanId?: string | null;
  outcome: string;
  httpStatus: number;
  errorCode?: string | null;
  correlationId: string;
  findingsAccepted?: number;
  findingsDeduped?: number;
  requestByteLength?: number;
  schemaVersion?: string | null;
}): Promise<void> {
  try {
    await db('repo_secret_ingestion_receipts').insert({
      organization_id: params.organizationId,
      workspace_id: params.workspaceId,
      connector_id: params.connectorId ?? null,
      idempotency_key: params.idempotencyKey ?? null,
      client_scan_id: params.clientScanId ?? null,
      outcome: params.outcome,
      http_status: params.httpStatus,
      error_code: params.errorCode ?? null,
      correlation_id: params.correlationId,
      findings_accepted: params.findingsAccepted ?? 0,
      findings_deduped: params.findingsDeduped ?? 0,
      request_byte_length: params.requestByteLength ?? null,
      schema_version: params.schemaVersion ?? null,
    });
  } catch {
    // Never fail the caller because the audit insert failed; do not log bodies.
  }
}

function scoutFingerprint(connectorId: string, fingerprint: string): string {
  return `repo-secret:${connectorId}:${fingerprint}`;
}

async function upsertConnector(
  ctx: IngestContext,
  payload: SecretScanIngestPayload,
): Promise<{ id: string }> {
  const existing = await db('repo_connectors')
    .where({
      organization_id: ctx.organizationId,
      workspace_id: ctx.workspaceId,
      connector_key: payload.connector_key,
    })
    .first();

  if (existing) {
    if (existing.status !== 'active') {
      throw Object.assign(new Error('connector_revoked'), { code: 'connector_revoked' });
    }
    const [row] = await db('repo_connectors')
      .where({ id: existing.id })
      .update({
        repository_alias: payload.repository_alias,
        product: payload.product ?? existing.product,
        last_ingest_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning(['id']);
    return row;
  }

  const [row] = await db('repo_connectors')
    .insert({
      organization_id: ctx.organizationId,
      workspace_id: ctx.workspaceId,
      connector_key: payload.connector_key,
      repository_alias: payload.repository_alias,
      product: payload.product ?? null,
      status: 'active',
      last_ingest_at: new Date().toISOString(),
    })
    .returning(['id']);
  return row;
}

async function mirrorFinding(params: {
  organizationId: string;
  workspaceId: string;
  connectorId: string;
  finding: SecretScanIngestPayload['findings'][number];
  scannerName: string;
  existingScoutFindingId?: string | null;
}): Promise<string> {
  const fingerprint = scoutFingerprint(params.connectorId, params.finding.fingerprint);
  const title = `Exposed secret (${params.finding.rule_id})`;
  const evidence = {
    source: 'repository_secret_scan',
    rule_id: params.finding.rule_id,
    relative_path: params.finding.relative_path ?? null,
    line: params.finding.line ?? null,
    commit_id: params.finding.commit_id ?? null,
    connector_id: params.connectorId,
  };

  if (params.existingScoutFindingId) {
    await db('findings')
      .where({
        id: params.existingScoutFindingId,
        organization_id: params.organizationId,
        workspace_id: params.workspaceId,
      })
      .update({
        severity: params.finding.severity,
        title,
        description: `Repository secret finding for rule ${params.finding.rule_id}`,
        evidence: JSON.stringify(evidence),
        last_seen_at: new Date().toISOString(),
        seen_count: db.raw('seen_count + 1'),
        status: 'open',
        resolved_at: null,
        resolved_by: null,
      });
    return params.existingScoutFindingId;
  }

  const existing = await db('findings')
    .where({
      organization_id: params.organizationId,
      workspace_id: params.workspaceId,
      fingerprint,
    })
    .whereNotIn('status', ['false_positive', 'duplicate'])
    .first();

  if (existing) {
    await db('findings')
      .where({ id: existing.id })
      .update({
        severity: params.finding.severity,
        title,
        description: `Repository secret finding for rule ${params.finding.rule_id}`,
        evidence: JSON.stringify(evidence),
        last_seen_at: new Date().toISOString(),
        seen_count: db.raw('seen_count + 1'),
        status: 'open',
        resolved_at: null,
        resolved_by: null,
      });
    return existing.id as string;
  }

  const [row] = await db('findings')
    .insert({
      organization_id: params.organizationId,
      workspace_id: params.workspaceId,
      scan_run_id: null,
      target_id: null,
      tool_name: params.scannerName,
      finding_type: 'exposed_secret',
      severity: params.finding.severity,
      title,
      description: `Repository secret finding for rule ${params.finding.rule_id}`,
      evidence: JSON.stringify(evidence),
      fingerprint,
      status: 'open',
    })
    .returning(['id']);
  return row.id as string;
}

async function upsertSecretFinding(params: {
  organizationId: string;
  workspaceId: string;
  connectorId: string;
  scanRunId: string;
  scannerName: string;
  finding: SecretScanIngestPayload['findings'][number];
}): Promise<{
  outcome: 'accepted' | 'deduped';
  findingId: string;
  scoutFindingId: string | null;
  isReopen: boolean;
}> {
  const active = await db('repo_secret_findings')
    .where({
      organization_id: params.organizationId,
      workspace_id: params.workspaceId,
      connector_id: params.connectorId,
      fingerprint: params.finding.fingerprint,
    })
    .whereNotIn('remediation_status', ['resolved', 'accepted-risk', 'false-positive'])
    .first();

  if (active) {
    const scoutFindingId = await mirrorFinding({
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      connectorId: params.connectorId,
      finding: params.finding,
      scannerName: params.scannerName,
      existingScoutFindingId: active.scout_finding_id as string | null,
    });
    await db('repo_secret_findings')
      .where({ id: active.id })
      .update({
        severity: params.finding.severity,
        relative_path: params.finding.relative_path ?? active.relative_path,
        line_number: params.finding.line ?? active.line_number,
        commit_id: params.finding.commit_id ?? active.commit_id,
        last_seen_at: new Date().toISOString(),
        last_scan_run_id: params.scanRunId,
        seen_count: db.raw('seen_count + 1'),
        scout_finding_id: scoutFindingId,
        updated_at: new Date().toISOString(),
      });
    return {
      outcome: 'deduped',
      findingId: active.id as string,
      scoutFindingId,
      isReopen: false,
    };
  }

  const closed = await db('repo_secret_findings')
    .where({
      organization_id: params.organizationId,
      workspace_id: params.workspaceId,
      connector_id: params.connectorId,
      fingerprint: params.finding.fingerprint,
    })
    .whereIn('remediation_status', ['resolved', 'accepted-risk', 'false-positive'])
    .orderBy('updated_at', 'desc')
    .first();

  if (closed) {
    const scoutFindingId = await mirrorFinding({
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      connectorId: params.connectorId,
      finding: params.finding,
      scannerName: params.scannerName,
      existingScoutFindingId: closed.scout_finding_id as string | null,
    });
    await db('repo_secret_findings')
      .where({ id: closed.id })
      .update({
        severity: params.finding.severity,
        relative_path: params.finding.relative_path ?? closed.relative_path,
        line_number: params.finding.line ?? closed.line_number,
        commit_id: params.finding.commit_id ?? closed.commit_id,
        remediation_status: 'open',
        last_seen_at: new Date().toISOString(),
        last_scan_run_id: params.scanRunId,
        seen_count: db.raw('seen_count + 1'),
        scout_finding_id: scoutFindingId,
        resolution_evidence: null,
        accepted_risk_expires_at: null,
        updated_at: new Date().toISOString(),
      });
    await db('repo_secret_remediation_events').insert({
      organization_id: params.organizationId,
      workspace_id: params.workspaceId,
      finding_id: closed.id,
      from_status: closed.remediation_status,
      to_status: 'open',
      actor: 'system:ingest',
      reason: 'finding reopened by subsequent scan',
      evidence_note: null,
      correlation_id: null,
    });
    return {
      outcome: 'accepted',
      findingId: closed.id as string,
      scoutFindingId,
      isReopen: true,
    };
  }

  const scoutFindingId = await mirrorFinding({
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    connectorId: params.connectorId,
    finding: params.finding,
    scannerName: params.scannerName,
  });

  const [inserted] = await db('repo_secret_findings')
    .insert({
      organization_id: params.organizationId,
      workspace_id: params.workspaceId,
      connector_id: params.connectorId,
      scout_finding_id: scoutFindingId,
      fingerprint: params.finding.fingerprint,
      rule_id: params.finding.rule_id,
      severity: params.finding.severity,
      relative_path: params.finding.relative_path ?? null,
      line_number: params.finding.line ?? null,
      commit_id: params.finding.commit_id ?? null,
      remediation_status: 'open',
      last_scan_run_id: params.scanRunId,
    })
    .returning(['id']);
  return {
    outcome: 'accepted',
    findingId: inserted.id as string,
    scoutFindingId,
    isReopen: false,
  };
}

export async function ingestSecretScan(
  ctx: IngestContext,
  body: unknown,
): Promise<IngestResult> {
  if (ctx.requestByteLength > MAX_INGEST_BYTES) {
    await writeReceipt({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      outcome: 'rejected',
      httpStatus: 413,
      errorCode: 'payload_too_large',
      correlationId: ctx.correlationId,
      requestByteLength: ctx.requestByteLength,
    });
    return {
      ok: false,
      status: 413,
      code: 'payload_too_large',
      correlationId: ctx.correlationId,
    };
  }

  const validated = validateSecretScanIngest(body);
  if (!validated.ok) {
    await writeReceipt({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      outcome: 'rejected',
      httpStatus: 400,
      errorCode: validated.code,
      correlationId: ctx.correlationId,
      requestByteLength: ctx.requestByteLength,
    });
    return {
      ok: false,
      status: 400,
      code: validated.code,
      correlationId: ctx.correlationId,
    };
  }

  const payload = validated.data;
  const sig = verifyIngestSignature({ apiKey: ctx.apiKey, payload });
  if (!sig.ok) {
    await writeReceipt({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      idempotencyKey: payload.idempotency_key,
      clientScanId: payload.scan_id,
      outcome: 'rejected',
      httpStatus: 401,
      errorCode: sig.code,
      correlationId: ctx.correlationId,
      requestByteLength: ctx.requestByteLength,
      schemaVersion: payload.schema_version,
    });
    return {
      ok: false,
      status: 401,
      code: sig.code,
      correlationId: ctx.correlationId,
    };
  }

  const existingRun = await db('repo_secret_scan_runs')
    .where({
      organization_id: ctx.organizationId,
      workspace_id: ctx.workspaceId,
      idempotency_key: payload.idempotency_key,
    })
    .first();

  if (existingRun) {
    await writeReceipt({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      connectorId: existingRun.connector_id as string,
      idempotencyKey: payload.idempotency_key,
      clientScanId: payload.scan_id,
      outcome: 'duplicate',
      httpStatus: 200,
      correlationId: ctx.correlationId,
      findingsAccepted: existingRun.findings_accepted as number,
      findingsDeduped: existingRun.findings_deduped as number,
      requestByteLength: ctx.requestByteLength,
      schemaVersion: payload.schema_version,
    });
    return {
      ok: true,
      status: 200,
      duplicate: true,
      scanRunId: existingRun.id as string,
      connectorId: existingRun.connector_id as string,
      findingsAccepted: existingRun.findings_accepted as number,
      findingsDeduped: existingRun.findings_deduped as number,
      correlationId: ctx.correlationId,
    };
  }

  let connector: { id: string };
  try {
    connector = await upsertConnector(ctx, payload);
  } catch (err) {
    const code = (err as { code?: string }).code === 'connector_revoked' ? 'connector_revoked' : 'error';
    await writeReceipt({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      idempotencyKey: payload.idempotency_key,
      clientScanId: payload.scan_id,
      outcome: code === 'connector_revoked' ? 'rejected' : 'error',
      httpStatus: code === 'connector_revoked' ? 403 : 500,
      errorCode: code,
      correlationId: ctx.correlationId,
      requestByteLength: ctx.requestByteLength,
      schemaVersion: payload.schema_version,
    });
    return {
      ok: false,
      status: code === 'connector_revoked' ? 403 : 500,
      code,
      correlationId: ctx.correlationId,
    };
  }

  const retainUntil = new Date();
  retainUntil.setDate(retainUntil.getDate() + 365);

  const [scanRun] = await db('repo_secret_scan_runs')
    .insert({
      organization_id: ctx.organizationId,
      workspace_id: ctx.workspaceId,
      connector_id: connector.id,
      client_scan_id: payload.scan_id,
      mode: payload.mode,
      scanner_name: payload.scanner_name,
      scanner_version: payload.scanner_version,
      status: payload.status,
      started_at: payload.started_at,
      completed_at: payload.completed_at,
      observed_at: payload.observed_at,
      count_critical: payload.counts.critical,
      count_high: payload.counts.high,
      count_medium: payload.counts.medium,
      count_low: payload.counts.low,
      count_info: payload.counts.info,
      hook_installed: payload.hook?.installed ?? null,
      hook_last_check_at: payload.hook?.last_check_at ?? null,
      environment_policy_ok: payload.environment_policy?.ok ?? null,
      environment_policy_detail: payload.environment_policy?.detail ?? null,
      idempotency_key: payload.idempotency_key,
      signature_algorithm: payload.signature.algorithm,
      signature_nonce: payload.signature.nonce,
      correlation_id: ctx.correlationId,
      retain_until: retainUntil.toISOString(),
    })
    .returning('*');

  let findingsAccepted = 0;
  let findingsDeduped = 0;
  for (const finding of payload.findings) {
    const result = await upsertSecretFinding({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      connectorId: connector.id,
      scanRunId: scanRun.id as string,
      scannerName: payload.scanner_name,
      finding,
    });
    if (result.outcome === 'accepted') {
      findingsAccepted += 1;
      await notifySecretFindingAccepted({
        scope: { organizationId: ctx.organizationId, workspaceId: ctx.workspaceId },
        repositoryAlias: payload.repository_alias,
        finding: {
          id: result.findingId,
          scoutFindingId: result.scoutFindingId,
          severity: finding.severity,
          ruleId: finding.rule_id,
          relativePath: finding.relative_path,
          line: finding.line,
          isReopen: result.isReopen,
        },
      }).catch(() => undefined);
    } else {
      findingsDeduped += 1;
    }
  }

  await db('repo_secret_scan_runs')
    .where({ id: scanRun.id })
    .update({
      findings_accepted: findingsAccepted,
      findings_deduped: findingsDeduped,
    });

  if (payload.status === 'failed') {
    await notifySecretScanFailed({
      scope: { organizationId: ctx.organizationId, workspaceId: ctx.workspaceId },
      repositoryAlias: payload.repository_alias,
      scanRunId: scanRun.id as string,
      mode: payload.mode,
      status: payload.status,
    }).catch(() => undefined);
  }

  await writeReceipt({
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    connectorId: connector.id,
    idempotencyKey: payload.idempotency_key,
    clientScanId: payload.scan_id,
    outcome: 'accepted',
    httpStatus: 201,
    correlationId: ctx.correlationId,
    findingsAccepted,
    findingsDeduped,
    requestByteLength: ctx.requestByteLength,
    schemaVersion: payload.schema_version,
  });

  return {
    ok: true,
    status: 201,
    duplicate: false,
    scanRunId: scanRun.id as string,
    connectorId: connector.id,
    findingsAccepted,
    findingsDeduped,
    correlationId: ctx.correlationId,
  };
}
