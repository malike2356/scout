// scout-engine/src/lib/plans.ts
// Plan catalog and limits. Plan names and Stripe price IDs must match the
// Stripe source of truth: /opt/lampp/htdocs/verlox/.access/.stripe-credentials-and-price-id.md
// Never invent new plans or prices here.
export type PlanName = 'free' | 'monitor' | 'govern' | 'team';

export interface PlanLimits {
  agents: number;
  rpm: number;
  killswitch: boolean;
  premium_alerts: boolean;
  retentionDays: number;
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  free: { agents: 1, rpm: 100, killswitch: false, premium_alerts: false, retentionDays: 7 },
  monitor: { agents: 5, rpm: 1000, killswitch: true, premium_alerts: false, retentionDays: 30 },
  govern: { agents: 20, rpm: 3000, killswitch: true, premium_alerts: true, retentionDays: 90 },
  team: { agents: 50, rpm: 5000, killswitch: true, premium_alerts: true, retentionDays: 365 },
};

export function isPlanName(value: string): value is PlanName {
  return Object.prototype.hasOwnProperty.call(PLAN_LIMITS, value);
}

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  const key = plan && isPlanName(plan) ? plan : 'free';
  return PLAN_LIMITS[key];
}

/**
 * Looks up the Stripe price id for a paid plan from environment variables.
 * Price ids come from the SoT file; never construct or create prices here.
 */
export function stripePriceIdForPlan(plan: string): string | null {
  switch (plan) {
    case 'monitor':
      return process.env.STRIPE_MONITOR_PRICE_ID || null;
    case 'govern':
      return process.env.STRIPE_GOVERN_PRICE_ID || null;
    case 'team':
      return process.env.STRIPE_TEAM_PRICE_ID || null;
    default:
      return null;
  }
}
