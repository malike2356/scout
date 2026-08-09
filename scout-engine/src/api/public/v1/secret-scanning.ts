// scout-engine/src/api/public/v1/secret-scanning.ts
import { Router, type Router as ExpressRouter } from 'express';
import type { TenantRequest } from '../../middleware/tenant-scope.js';
import { newCorrelationId, sendSecretScanError } from '../../../secret-scanning/errors.js';
import { ingestSecretScan } from '../../../secret-scanning/ingest.js';
import {
  getAggregatePosture,
  getConnector,
  getFinding,
  getScanRun,
  listConnectors,
  listFindings,
  listPendingScanRequestsByConnectorKey,
  acknowledgeScanRequest,
  listScanRuns,
  transitionRemediation,
  exportRedactedFindings,
} from '../../../secret-scanning/service.js';
import { getSecretScanHealth } from '../../../secret-scanning/health.js';

export const secretScanningRouter: ExpressRouter = Router();

function extractApiKey(req: TenantRequest): string | null {
  const headerKey = req.headers['x-scout-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith('sk_live_')) return token;
  }
  return null;
}

function tenantScope(req: TenantRequest) {
  return {
    organizationId: req.organizationId!,
    workspaceId: req.workspaceId!,
  };
}

function parsePaging(query: Record<string, unknown>) {
  const limit = Math.min(Math.max(parseInt(String(query.limit ?? '50'), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(query.offset ?? '0'), 10) || 0, 0);
  return { limit, offset };
}

secretScanningRouter.post('/repository-secret-scans', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const tenantReq = req as TenantRequest;
    const apiKey = extractApiKey(tenantReq);
    if (!apiKey) {
      sendSecretScanError(res, 401, 'unauthorized', correlationId);
      return;
    }

    const rawLength =
      typeof req.headers['content-length'] === 'string'
        ? parseInt(req.headers['content-length'], 10)
        : Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');

    const result = await ingestSecretScan(
      {
        organizationId: tenantReq.organizationId!,
        workspaceId: tenantReq.workspaceId!,
        apiKey,
        correlationId,
        requestByteLength: Number.isFinite(rawLength) ? rawLength : 0,
      },
      req.body,
    );

    if (!result.ok) {
      sendSecretScanError(res, result.status, result.code, result.correlationId);
      return;
    }

    res.status(result.status).json({
      scan_run_id: result.scanRunId,
      connector_id: result.connectorId,
      duplicate: result.duplicate,
      findings_accepted: result.findingsAccepted,
      findings_deduped: result.findingsDeduped,
      correlation_id: result.correlationId,
    });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.get('/repository-connectors', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const connectors = await listConnectors(tenantScope(req as TenantRequest));
    res.json({ connectors, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.get('/repository-connectors/:id', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const connector = await getConnector(tenantScope(req as TenantRequest), req.params.id);
    if (!connector) {
      sendSecretScanError(res, 404, 'not_found', correlationId);
      return;
    }
    res.json({ connector, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.get('/repository-connectors/:connectorKey/scan-requests', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const result = await listPendingScanRequestsByConnectorKey(
      tenantScope(req as TenantRequest),
      req.params.connectorKey,
    );
    if (!result) {
      sendSecretScanError(res, 404, 'not_found', correlationId);
      return;
    }
    res.json({ ...result, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.post(
  '/repository-connectors/:connectorKey/scan-requests/:requestId/ack',
  async (req, res) => {
    const correlationId = newCorrelationId();
    try {
      const result = await acknowledgeScanRequest(
        tenantScope(req as TenantRequest),
        req.params.connectorKey,
        req.params.requestId,
      );
      if (!result.ok) {
        sendSecretScanError(res, result.status, result.code, correlationId);
        return;
      }
      res.json({ request: result.request, correlation_id: correlationId });
    } catch {
      sendSecretScanError(res, 500, 'internal', correlationId);
    }
  },
);
secretScanningRouter.get('/repository-secret-scans', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const q = req.query as Record<string, unknown>;
    const page = parsePaging(q);
    const result = await listScanRuns(tenantScope(req as TenantRequest), {
      connectorId: typeof q.connector_id === 'string' ? q.connector_id : undefined,
      ...page,
    });
    res.json({ ...result, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.get('/repository-secret-scans/:id', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const scanRun = await getScanRun(tenantScope(req as TenantRequest), req.params.id);
    if (!scanRun) {
      sendSecretScanError(res, 404, 'not_found', correlationId);
      return;
    }
    res.json({ scan_run: scanRun, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.get('/repository-secret-findings', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const q = req.query as Record<string, unknown>;
    const page = parsePaging(q);
    const result = await listFindings(tenantScope(req as TenantRequest), {
      connectorId: typeof q.connector_id === 'string' ? q.connector_id : undefined,
      status: typeof q.status === 'string' ? q.status : undefined,
      severity: typeof q.severity === 'string' ? q.severity : undefined,
      ...page,
    });
    res.json({ ...result, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.get('/repository-secret-findings/:id', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const detail = await getFinding(tenantScope(req as TenantRequest), req.params.id);
    if (!detail) {
      sendSecretScanError(res, 404, 'not_found', correlationId);
      return;
    }
    res.json({ ...detail, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.post('/repository-secret-findings/:id/remediation', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await transitionRemediation({
      scope: tenantScope(req as TenantRequest),
      findingId: req.params.id,
      toStatus: String(body.status ?? ''),
      actor: String(body.actor ?? ''),
      reason: String(body.reason ?? ''),
      evidenceNote: typeof body.evidence_note === 'string' ? body.evidence_note : undefined,
      dueAt: typeof body.due_at === 'string' ? body.due_at : undefined,
      acceptedRiskExpiresAt:
        typeof body.accepted_risk_expires_at === 'string'
          ? body.accepted_risk_expires_at
          : undefined,
      remediationOwner:
        typeof body.remediation_owner === 'string' ? body.remediation_owner : undefined,
      correlationId,
    });
    if (!result.ok) {
      sendSecretScanError(res, result.status, result.code, correlationId);
      return;
    }
    res.json({ finding: result.finding, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.get('/repository-security/posture', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const posture = await getAggregatePosture(tenantScope(req as TenantRequest));
    res.json({ posture, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.get('/repository-security/export', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const exportPayload = await exportRedactedFindings(tenantScope(req as TenantRequest));
    res.json({ ...exportPayload, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});

secretScanningRouter.get('/repository-security/health', async (req, res) => {
  const correlationId = newCorrelationId();
  try {
    const health = await getSecretScanHealth();
    res.json({ health, correlation_id: correlationId });
  } catch {
    sendSecretScanError(res, 500, 'internal', correlationId);
  }
});
