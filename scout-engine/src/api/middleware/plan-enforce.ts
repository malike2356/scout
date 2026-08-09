// scout-engine/src/api/middleware/plan-enforce.ts
// Plan-based feature gating and agent-count enforcement. Works for both the
// API-key tenant middleware and the dashboard JWT middleware, since both
// attach organizationId and organization ({ plan }) to the request.
import type { NextFunction, Request, Response } from 'express';
import { db } from '../../db/index.js';
import { getPlanLimits, type PlanLimits } from '../../lib/plans.js';

interface OrgScopedRequest extends Request {
  organizationId?: string;
  organization?: { plan?: string } & Record<string, unknown>;
}

type BooleanPlanFeature = {
  [K in keyof PlanLimits]: PlanLimits[K] extends boolean ? K : never;
}[keyof PlanLimits];

export function requirePlanFeature(feature: BooleanPlanFeature) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const orgReq = req as OrgScopedRequest;
    const plan = orgReq.organization?.plan ?? 'free';
    const limits = getPlanLimits(plan);

    if (!limits[feature]) {
      res.status(403).json({
        error: 'plan_limit',
        message: `This feature requires a higher plan. Current plan: ${plan}.`,
        retry_after: 0,
      });
      return;
    }

    next();
  };
}

export async function checkAgentLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgReq = req as OrgScopedRequest;
    const organizationId = orgReq.organizationId;
    if (!organizationId) {
      res.status(401).json({ error: 'unauthorized', message: 'Missing organization context.' });
      return;
    }

    const plan = orgReq.organization?.plan ?? 'free';
    const limits = getPlanLimits(plan);

    const result = await db('connected_agents')
      .where({ organization_id: organizationId })
      .whereNot('status', 'suspended')
      .count('* as count')
      .first();
    const count = parseInt((result?.count as string) || '0', 10);

    if (count >= limits.agents) {
      res.status(403).json({
        error: 'plan_limit',
        message: `Agent limit reached for the ${plan} plan (${limits.agents} max). Upgrade to add more agents.`,
        retry_after: 0,
      });
      return;
    }

    next();
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
}
