// scout-engine/src/api/middleware/tenant-scope.ts
// Resolves an organization from a public API key (Bearer sk_live_... or
// X-Scout-Key) and attaches organization/workspace context to the request.
// Used by the public /v1 router; the internal /api/v1 engine routes keep
// their existing workspace-header auth (see ../auth-middleware.ts).
import type { NextFunction, Request, Response } from 'express';
import { getOrganizationFromApiKey } from '../../lib/api-keys.js';
import { getOrCreateDefaultWorkspace } from '../../lib/org-workspace.js';

export interface TenantRequest extends Request {
  organizationId?: string;
  organization?: Record<string, unknown>;
  workspaceId?: string;
}

function extractApiKey(req: Request): string | null {
  const headerKey = req.headers['x-scout-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith('sk_live_')) return token;
  }

  return null;
}

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing API key. Provide Authorization: Bearer sk_live_... or X-Scout-Key.',
    });
    return;
  }

  try {
    const organization = await getOrganizationFromApiKey(apiKey);
    if (!organization) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid or revoked API key.' });
      return;
    }

    const tenantReq = req as TenantRequest;
    tenantReq.organizationId = organization.id as string;
    tenantReq.organization = organization;
    tenantReq.workspaceId = await getOrCreateDefaultWorkspace(organization.id as string);
    next();
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
}
