// scout-engine/src/scoring/scout-score.ts
// Full Scout Score calculation engine with weighted categories and trends
import { db } from '../db/index.js';

export interface ScoreBreakdown {
  total: number; // 0-100
  categories: {
    exposure: number; // Open ports, services (0-100)
    vulnerabilities: number; // CVEs, vuln findings (0-100)
    compliance: number; // SOC2 controls covered (0-100)
    agentSafety: number; // Agent monitoring safety (0-100)
  };
  weights: {
    exposure: number;
    vulnerabilities: number;
    compliance: number;
    agentSafety: number;
  };
  trend: {
    direction: 'up' | 'down' | 'stable';
    change: number;
    previousScore: number;
  };
  findingCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  calculatedAt: string;
}

const DEFAULT_WEIGHTS = {
  exposure: 0.25,
  vulnerabilities: 0.35,
  compliance: 0.25,
  agentSafety: 0.15,
};

export async function calculateScoutScore(workspaceId: string): Promise<ScoreBreakdown> {
  // 1. Exposure Score: penalized by open ports and exposed services
  const exposureScore = await calculateExposureScore(workspaceId);

  // 2. Vulnerability Score: penalized by CVEs and vuln findings
  const vulnScore = await calculateVulnerabilityScore(workspaceId);

  // 3. Compliance Score: percentage of SOC2 controls with evidence
  const complianceScore = await calculateComplianceScore(workspaceId);

  // 4. Agent Safety Score: penalized by suspicious agent activity
  const agentSafetyScore = await calculateAgentSafetyScore(workspaceId);

  // Weighted total
  const total = Math.round(
    exposureScore * DEFAULT_WEIGHTS.exposure +
    vulnScore * DEFAULT_WEIGHTS.vulnerabilities +
    complianceScore * DEFAULT_WEIGHTS.compliance +
    agentSafetyScore * DEFAULT_WEIGHTS.agentSafety
  );

  // Trend
  const trend = await calculateTrend(workspaceId, Math.max(0, Math.min(100, total)));

  // Finding counts
  const findingCounts = await getFindingCounts(workspaceId);

  return {
    total: Math.max(0, Math.min(100, total)),
    categories: {
      exposure: exposureScore,
      vulnerabilities: vulnScore,
      compliance: complianceScore,
      agentSafety: agentSafetyScore,
    },
    weights: DEFAULT_WEIGHTS,
    trend,
    findingCounts,
    calculatedAt: new Date().toISOString(),
  };
}

async function calculateExposureScore(workspaceId: string): Promise<number> {
  try {
    const findings = await db('findings')
      .where({ workspace_id: workspaceId, status: 'open' })
      .whereIn('finding_type', ['open_port', 'service', 'subdomain', 'exposed_secret'])
      .where('last_seen_at', '>=', db.raw("NOW() - INTERVAL '30 days'"));

    // Penalty per finding by severity
    const penalties: Record<string, number> = {
      critical: 15,
      high: 8,
      medium: 4,
      low: 2,
      info: 0.5,
    };

    let penalty = 0;
    let secretPenalty = 0;
    for (const f of findings) {
      const amount = penalties[f.severity] || 0;
      if (f.finding_type === 'exposed_secret') {
        // Cap repository-secret contribution so repeated reopen spam cannot zero the score alone.
        secretPenalty = Math.min(40, secretPenalty + amount);
      } else {
        penalty += amount;
      }
    }
    penalty += secretPenalty;

    return Math.max(0, 100 - penalty);
  } catch {
    return 70; // Default if no data
  }
}

async function calculateVulnerabilityScore(workspaceId: string): Promise<number> {
  try {
    const findings = await db('findings')
      .where({ workspace_id: workspaceId, status: 'open' })
      .whereIn('finding_type', ['vulnerability', 'cve', 'misconfiguration', 'certificate_issue'])
      .where('last_seen_at', '>=', db.raw("NOW() - INTERVAL '30 days'"));

    let penalty = 0;
    for (const f of findings) {
      // CVSS-based penalty for CVEs
      if (f.cvss_score) {
        if (f.cvss_score >= 9.0) penalty += 20;
        else if (f.cvss_score >= 7.0) penalty += 12;
        else if (f.cvss_score >= 4.0) penalty += 6;
        else penalty += 3;
      } else {
        // Severity-based penalty
        const sevPenalties: Record<string, number> = {
          critical: 15, high: 8, medium: 4, low: 2, info: 1,
        };
        penalty += sevPenalties[f.severity] || 0;
      }
    }

    return Math.max(0, 100 - penalty);
  } catch {
    return 50;
  }
}

async function calculateComplianceScore(workspaceId: string): Promise<number> {
  try {
    const result = await db('compliance_evidence')
      .where('workspace_id', workspaceId)
      .where('collected_at', '>=', db.raw("NOW() - INTERVAL '12 months'"))
      .countDistinct('control_id as count')
      .first();

    const covered = parseInt((result?.count as string) || '0');
    return Math.min(100, Math.round((covered / 14) * 100));
  } catch {
    return 50;
  }
}

async function calculateAgentSafetyScore(workspaceId: string): Promise<number> {
  try {
    const suspiciousCount = await db('findings')
      .where({ workspace_id: workspaceId, status: 'open' })
      .whereIn('finding_type', ['suspicious_activity', 'intrusion_alert'])
      .where('last_seen_at', '>=', db.raw("NOW() - INTERVAL '7 days'"))
      .count('* as count')
      .first();

    const count = parseInt((suspiciousCount?.count as string) || '0');
    return Math.max(0, 100 - count * 10);
  } catch {
    return 80;
  }
}

async function calculateTrend(
  workspaceId: string,
  currentScore: number,
): Promise<ScoreBreakdown['trend']> {
  try {
    // Compare to score from 7 days ago
    const previousScore = await db('scout_scores')
      .where({ workspace_id: workspaceId })
      .where('calculated_at', '<=', db.raw("NOW() - INTERVAL '7 days'"))
      .orderBy('calculated_at', 'desc')
      .first();

    const prev = previousScore?.total ?? currentScore;
    const change = currentScore - prev;

    return {
      direction: change > 1 ? 'up' : change < -1 ? 'down' : 'stable',
      change: Math.round(change),
      previousScore: prev,
    };
  } catch {
    return { direction: 'stable', change: 0, previousScore: currentScore };
  }
}

async function getFindingCounts(workspaceId: string): Promise<ScoreBreakdown['findingCounts']> {
  try {
    const rows = await db('findings')
      .where({ workspace_id: workspaceId, status: 'open' })
      .where('last_seen_at', '>=', db.raw("NOW() - INTERVAL '30 days'"))
      .select('severity')
      .count('* as count')
      .groupBy('severity');

    const counts: any = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const row of rows) {
      counts[row.severity] = parseInt(row.count as string);
    }
    return counts;
  } catch {
    return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  }
}

export async function generateScoreDropReason(workspaceId: string, score: ScoreBreakdown): Promise<string> {
  const reasons: string[] = [];
  if (score.findingCounts.critical > 0) reasons.push(`${score.findingCounts.critical} critical findings`);
  if (score.findingCounts.high > 0) reasons.push(`${score.findingCounts.high} high findings`);
  if (score.categories.vulnerabilities < 50) reasons.push('low vulnerability score');
  if (score.categories.exposure < 50) reasons.push('high exposure');
  return reasons.length > 0 ? reasons.join(', ') : 'score decreased across multiple categories';
}
