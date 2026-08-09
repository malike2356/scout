// scout-engine/src/api/middleware/dashboard-auth.ts
// JWT auth for the customer dashboard and billing APIs (separate from the
// public API-key tenant middleware and the internal workspace auth).
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { resolveJwtSecret } from '../auth-middleware.js';

export interface DashboardRequest extends Request {
  organizationId?: string;
  userId?: string;
  email?: string;
  workspaceId?: string | null;
  organization?: Record<string, unknown>;
}

interface DashboardTokenPayload {
  organizationId: string;
  userId: string;
  email?: string;
}

export function signDashboardToken(payload: DashboardTokenPayload): string {
  return jwt.sign(payload, resolveJwtSecret(), { expiresIn: '7d' });
}

export function dashboardAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token.' });
    return;
  }

  try {
    const payload = jwt.verify(authHeader.slice(7), resolveJwtSecret()) as DashboardTokenPayload;
    if (!payload.organizationId || !payload.userId) throw new Error('invalid token payload');

    const dashboardReq = req as DashboardRequest;
    dashboardReq.organizationId = payload.organizationId;
    dashboardReq.userId = payload.userId;
    dashboardReq.email = payload.email;
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token.' });
  }
}
