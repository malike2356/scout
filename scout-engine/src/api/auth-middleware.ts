import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

function authDisabled(): boolean {
  return process.env.SCOUT_AUTH_DISABLED === 'true';
}

function configuredApiKeys(): Set<string> {
  const keys = new Set<string>();
  const single = process.env.SCOUT_API_KEY?.trim();
  if (single) keys.add(single);
  for (const key of (process.env.SCOUT_API_KEYS ?? '').split(',')) {
    const trimmed = key.trim();
    if (trimmed) keys.add(trimmed);
  }
  return keys;
}

export function validateApiKey(apiKey: string | undefined): boolean {
  if (authDisabled()) return true;
  const keys = configuredApiKeys();
  if (keys.size === 0) return true;
  return Boolean(apiKey && keys.has(apiKey));
}

export function createApiRateLimiter() {
  return rateLimit({
    windowMs: 60_000,
    max: Number.parseInt(process.env.SCOUT_API_RATE_LIMIT ?? '100', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const apiKey = req.headers['x-scout-key'];
      if (typeof apiKey === 'string' && apiKey) return apiKey;
      return req.ip ?? 'anonymous';
    },
    message: { error: 'Rate limit exceeded. Try again in one minute.' },
  });
}

export function resolveJwtSecret(): string {
  return process.env.SCOUT_JWT_SECRET ?? process.env.SCOUT_API_KEY ?? 'scout-dev-jwt-secret-change-me';
}

export function issueWorkspaceToken(workspaceId: string, apiKey: string): string {
  return jwt.sign(
    { workspaceId, apiKeyHint: apiKey.slice(0, 6) },
    resolveJwtSecret(),
    { expiresIn: '24h' },
  );
}

function workspaceFromRequest(req: Request): string {
  const headerWorkspace = req.headers['x-workspace-id'];
  const queryWorkspace = req.query.workspace_id;
  const workspaceId = typeof headerWorkspace === 'string'
    ? headerWorkspace
    : typeof queryWorkspace === 'string'
      ? queryWorkspace
      : DEFAULT_WORKSPACE_ID;
  return !workspaceId || workspaceId === 'default' ? DEFAULT_WORKSPACE_ID : workspaceId;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const workspaceId = workspaceFromRequest(req);
  (req as Request & { workspaceId?: string }).workspaceId = workspaceId;

  if (authDisabled()) {
    next();
    return;
  }

  const keys = configuredApiKeys();
  if (keys.size === 0) {
    next();
    return;
  }

  const apiKey = req.headers['x-scout-key'];
  if (typeof apiKey === 'string' && validateApiKey(apiKey)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), resolveJwtSecret()) as { workspaceId?: string };
      if (payload.workspaceId) {
        (req as Request & { workspaceId?: string }).workspaceId = payload.workspaceId;
      }
      next();
      return;
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
  }

  res.status(401).json({ error: 'Missing or invalid API key. Provide X-Scout-Key or Authorization Bearer token.' });
}
