export interface PlanInfo {
  id: 'free' | 'monitor' | 'govern' | 'team';
  name: string;
  price: string;
  tagline: string;
  features: string[];
}

export const PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    price: '£0',
    tagline: '1 agent, basic prompt filtering',
    features: ['1 agent', 'Basic prompt filtering', '7 day history'],
  },
  {
    id: 'monitor',
    name: 'Monitor',
    price: '£99/mo',
    tagline: 'Full filtering, kill switch, alerts',
    features: ['5 agents', 'Full filtering', 'Kill switch', 'Alerts', '90 day history'],
  },
  {
    id: 'govern',
    name: 'Govern',
    price: '£199/mo',
    tagline: 'Deeper monitoring, audit logs',
    features: ['20 agents', 'Deeper monitoring', 'Audit logs', 'Everything in Monitor'],
  },
  {
    id: 'team',
    name: 'Team',
    price: '£399/mo',
    tagline: 'Team dashboard, SSO, priority support',
    features: ['50 agents', 'Team dashboard', 'SSO', 'Priority support', 'Everything in Govern'],
  },
];

export function planLabel(plan?: string | null): string {
  const found = PLANS.find((p) => p.id === plan);
  return found?.name ?? 'Free';
}
