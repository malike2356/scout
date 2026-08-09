// scout-engine/src/reports/generator.ts
// Report generation: weekly, monthly, quarterly, custom
// Generates HTML + PDF reports with Handlebars templates
import { db } from '../db/index.js';
import { calculateScoutScore } from '../scoring/scout-score.js';
import Handlebars from 'handlebars';
import { marked } from 'marked';

interface ReportOptions {
  workspaceId: string;
  type: 'weekly' | 'monthly' | 'quarterly' | 'custom';
  dateRange: { start: string; end: string };
  title?: string;
}

interface ReportData {
  type: string;
  title: string;
  dateRange: { start: string; end: string };
  workspaceName: string;
  generatedAt: string;
  scoutScore: any;
  scoreHistory: any[];
  findings: any[];
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  topVulnerabilities: any[];
  scans: any[];
  agents: any[];
  compliance: any;
}

export async function generateReport(options: ReportOptions): Promise<{ html: string; pdf?: Buffer }> {
  const data = await gatherReportData(options);

  const html = renderReportHtml(data);

  // PDF generation via Puppeteer (optional)
  // If Puppeteer is available, generate PDF
  let pdf: Buffer | undefined;
  try {
    pdf = await htmlToPdf(html);
  } catch {
    console.warn('[Reports] PDF generation unavailable; HTML report only');
  }

  return { html, pdf };
}

async function gatherReportData(options: ReportOptions): Promise<ReportData> {
  const { workspaceId, type, dateRange } = options;

  // Workspace name
  const ws = await db('workspaces').where({ id: workspaceId }).first();
  const workspaceName = ws?.name || 'Workspace';

  // Current scout score
  const scoutScore = await calculateScoutScore(workspaceId);

  // Score history
  const scoreHistory = await db('scout_scores')
    .where({ workspace_id: workspaceId })
    .where('calculated_at', '>=', dateRange.start)
    .where('calculated_at', '<=', dateRange.end)
    .orderBy('calculated_at', 'asc');

  // Findings
  const findings = await db('findings')
    .where({ workspace_id: workspaceId })
    .where('first_seen_at', '>=', dateRange.start)
    .where('first_seen_at', '<=', dateRange.end)
    .orderBy('severity_order', 'asc')
    .limit(100);

  // By severity
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }

  // By status
  const statusRows = await db('findings')
    .where({ workspace_id: workspaceId })
    .select('status')
    .count('* as count')
    .groupBy('status');
  const byStatus: Record<string, number> = {};
  for (const r of statusRows) {
    byStatus[r.status] = parseInt(r.count as string);
  }

  // Top vulnerabilities (by CVSS)
  const topVulnerabilities = findings
    .filter(f => f.cvss_score)
    .sort((a, b) => (b.cvss_score || 0) - (a.cvss_score || 0))
    .slice(0, 10);

  // Scans
  const scans = await db('scan_runs')
    .where({ workspace_id: workspaceId })
    .where('started_at', '>=', dateRange.start)
    .orderBy('started_at', 'desc')
    .limit(20);

  // Agents
  const agents = await db('connected_agents')
    .where({ workspace_id: workspaceId })
    .orderBy('last_heartbeat', 'desc');

  // Compliance
  const compliance = await db('compliance_evidence')
    .where('workspace_id', workspaceId)
    .countDistinct('control_id as count')
    .first();

  const title = options.title || `${type.charAt(0).toUpperCase() + type.slice(1)} Security Report`;

  return {
    type,
    title,
    dateRange,
    workspaceName,
    generatedAt: new Date().toISOString(),
    scoutScore,
    scoreHistory: scoreHistory.map((s: any) => ({
      score: s.total,
      categories: typeof s.categories === 'string' ? JSON.parse(s.categories) : s.categories,
      date: s.calculated_at,
    })),
    findings,
    bySeverity,
    byStatus,
    topVulnerabilities,
    scans,
    agents,
    compliance,
  };
}

function renderReportHtml(data: ReportData): string {
  const template = REPORT_TEMPLATE;
  const compiled = Handlebars.compile(template);
  return compiled(data);
}

async function htmlToPdf(html: string): Promise<Buffer> {
  // Requires puppeteer to be installed
  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();
    return Buffer.from(pdf);
  } catch {
    throw new Error('Puppeteer not available');
  }
}

// ════════════════════════════════════════════
// Report HTML Template (Handlebars)
// ════════════════════════════════════════════

const REPORT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{title}}; Labyrinth Scout</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color: #1f2937; background: #fff; }
  .header { background: linear-gradient(135deg, #312e81, #4f46e5); color: white; padding: 40px; }
  .header h1 { font-size: 28px; margin-bottom: 8px; }
  .header .meta { opacity: 0.8; font-size: 14px; }
  .container { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
  .score-card { background: linear-gradient(135deg, #312e81, #4f46e5); color: white; padding: 32px; border-radius: 12px; margin-bottom: 32px; text-align: center; }
  .score-card .score { font-size: 72px; font-weight: 800; line-height: 1; }
  .score-card .label { font-size: 14px; opacity: 0.8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; }
  .section { margin-bottom: 32px; }
  .section h2 { font-size: 20px; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .stat { padding: 16px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; }
  .stat .value { font-size: 28px; font-weight: 700; }
  .stat .label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 10px 12px; background: #f9fafb; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #374151; }
  td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
  .severity { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .severity-critical { background: #fef2f2; color: #dc2626; }
  .severity-high { background: #fff7ed; color: #ea580c; }
  .severity-medium { background: #fefce8; color: #ca8a04; }
  .severity-low { background: #eff6ff; color: #2563eb; }
  .severity-info { background: #f9fafb; color: #6b7280; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; text-align: center; }
  .bars { display: flex; gap: 8px; margin-top: 16px; }
  .bar-group { flex: 1; }
  .bar-label { font-size: 10px; color: #6b7280; text-align: center; margin-bottom: 4px; }
  .bar-track { height: 8px; background: rgba(255,255,255,0.2); border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; background: white; border-radius: 4px; transition: width 0.3s; }
  @media print { body { font-size: 12px; } }
</style>
</head>
<body>
<div class="header">
  <h1>{{title}}</h1>
  <div class="meta">
    {{workspaceName}} | {{dateRange.start}} to {{dateRange.end}} | Generated {{generatedAt}}
  </div>
</div>

<div class="container">
  <!-- Scout Score -->
  <div class="score-card">
    <div class="label">Scout Score</div>
    <div class="score">{{scoutScore.total}}</div>
    <div style="margin-top:8px;font-size:14px;opacity:0.9">
      {{#if scoutScore.trend}}
        {{#if (eq scoutScore.trend.direction "up")}}▲ +{{scoutScore.trend.change}}{{/if}}
        {{#if (eq scoutScore.trend.direction "down")}}▼ {{scoutScore.trend.change}}{{/if}}
        {{#if (eq scoutScore.trend.direction "stable")}}; stable{{/if}}
      {{/if}}
    </div>
    <div class="bars">
      <div class="bar-group">
        <div class="bar-label">Exposure {{scoutScore.categories.exposure}}</div>
        <div class="bar-track"><div class="bar-fill" style="width:{{scoutScore.categories.exposure}}%"></div></div>
      </div>
      <div class="bar-group">
        <div class="bar-label">Vulns {{scoutScore.categories.vulnerabilities}}</div>
        <div class="bar-track"><div class="bar-fill" style="width:{{scoutScore.categories.vulnerabilities}}%"></div></div>
      </div>
      <div class="bar-group">
        <div class="bar-label">Compliance {{scoutScore.categories.compliance}}</div>
        <div class="bar-track"><div class="bar-fill" style="width:{{scoutScore.categories.compliance}}%"></div></div>
      </div>
      <div class="bar-group">
        <div class="bar-label">Agent {{scoutScore.categories.agentSafety}}</div>
        <div class="bar-track"><div class="bar-fill" style="width:{{scoutScore.categories.agentSafety}}%"></div></div>
      </div>
    </div>
  </div>

  <!-- Summary Stats -->
  <div class="section">
    <h2>Summary</h2>
    <div class="grid">
      <div class="stat"><div class="value">{{bySeverity.critical}}</div><div class="label">Critical</div></div>
      <div class="stat"><div class="value">{{bySeverity.high}}</div><div class="label">High</div></div>
      <div class="stat"><div class="value">{{bySeverity.medium}}</div><div class="label">Medium</div></div>
      <div class="stat"><div class="value">{{bySeverity.low}}</div><div class="label">Low</div></div>
      <div class="stat"><div class="value">{{byStatus.open}}</div><div class="label">Open</div></div>
      <div class="stat"><div class="value">{{byStatus.remediated}}</div><div class="label">Resolved</div></div>
    </div>
  </div>

  <!-- Top Vulnerabilities -->
  <div class="section">
    <h2>Top Vulnerabilities (by CVSS)</h2>
    {{#if topVulnerabilities.length}}
    <table>
      <thead><tr><th>CVE</th><th>Title</th><th>CVSS</th><th>Severity</th></tr></thead>
      <tbody>
      {{#each topVulnerabilities}}
      <tr>
        <td>{{cve_id}}</td>
        <td>{{title}}</td>
        <td>{{cvss_score}}</td>
        <td><span class="severity severity-{{severity}}">{{severity}}</span></td>
      </tr>
      {{/each}}
      </tbody>
    </table>
    {{else}}
    <p style="color:#6b7280">No CVEs found in this period.</p>
    {{/if}}
  </div>

  <!-- Recent Findings -->
  <div class="section">
    <h2>Recent Findings</h2>
    {{#if findings.length}}
    <table>
      <thead><tr><th>Severity</th><th>Title</th><th>Host</th><th>Status</th></tr></thead>
      <tbody>
      {{#each findings}}
      <tr>
        <td><span class="severity severity-{{severity}}">{{severity}}</span></td>
        <td>{{title}}</td>
        <td>{{affected_host}}</td>
        <td>{{status}}</td>
      </tr>
      {{/each}}
      </tbody>
    </table>
    {{else}}
    <p style="color:#6b7280">No findings in this period.</p>
    {{/if}}
  </div>

  <!-- Recent Scans -->
  <div class="section">
    <h2>Recent Scans</h2>
    {{#if scans.length}}
    <table>
      <thead><tr><th>Status</th><th>Duration</th><th>Findings</th><th>Date</th></tr></thead>
      <tbody>
      {{#each scans}}
      <tr>
        <td>{{status}}</td>
        <td>{{#if duration_ms}}{{duration_ms}}ms{{else}};{{/if}}</td>
        <td>{{findings_new}} new / {{findings_total}} total</td>
        <td>{{started_at}}</td>
      </tr>
      {{/each}}
      </tbody>
    </table>
    {{/if}}
  </div>

  <div class="footer">
    Generated by Labyrinth Scout | https://labyrinthscout.com<br>
    This report is confidential and intended for the recipient only.
  </div>
</div>
</body>
</html>`;
