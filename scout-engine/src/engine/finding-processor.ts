// scout-engine/src/engine/finding-processor.ts
// Parses tool output into structured findings, handles deduplication
import crypto from 'crypto';
import { db } from '../db/index.js';
import type { ScoutTool } from '../tools/registry.js';

interface ProcessResult {
  total: number;
  new_: number;
}

interface ParsedFinding {
  finding_type: string;
  severity: string;
  title: string;
  description?: string;
  affected_host?: string;
  affected_port?: number;
  cve_id?: string;
  cvss_score?: number;
  cvss_vector?: string;
  remediation?: string;
  reference_urls?: string[];
  evidence: Record<string, unknown>;
}

function sanitizeSeverity(sev: string): string {
  const s = sev?.toLowerCase() || 'info';
  if (['critical', 'high', 'medium', 'low', 'info'].includes(s)) return s;
  return 'info';
}

function buildFingerprint(
  findingType: string,
  host: string,
  port: number | undefined,
  title: string,
): string {
  const raw = `${findingType}|${host}|${port || 0}|${title}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function parseNmapXml(xml: string, tool: ScoutTool): ParsedFinding[] {
  const findings: ParsedFinding[] = [];
  // Simple regex-based XML parsing for nmap output
  const hostRegex = /<host[^>]*>.*?<address[^>]*addr="([^"]+)".*?<\/host>/gs;
  const portRegex = /<port[^>]*protocol="([^"]+)"[^>]*portid="(\d+)"[^>]*>.*?<state[^>]*state="([^"]+)".*?<service[^>]*name="([^"]*)"[^>]*(?:product="([^"]*)")?[^>]*(?:tunnel="([^"]*)")?[^>]*\/?>/gs;

  let hostMatch;
  while ((hostMatch = hostRegex.exec(xml)) !== null) {
    const host = hostMatch[1];
    let portMatch;
    const hostSection = hostMatch[0];
    while ((portMatch = portRegex.exec(hostSection)) !== null) {
      const [, proto, portStr, state, svcName, product, tunnel] = portMatch;
      if (state !== 'open') continue;
      const port = parseInt(portStr);
      const svc = product || svcName;
      findings.push({
        finding_type: 'open_port',
        severity: tunnel === 'ssl' ? 'medium' : 'low',
        title: svc ? `${svc} on port ${port}/${proto}` : `Open port ${port}/${proto}`,
        affected_host: host,
        affected_port: port,
        evidence: { host, port, proto, service: svcName, product, tunnel },
      });
    }
  }
  return findings;
}

function parseJsonOutput(output: string, tool: ScoutTool): ParsedFinding[] {
  const findings: ParsedFinding[] = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (!parsed) continue;

      // Nuclei format
      if (tool.name === 'nuclei' && parsed.info) {
        const sev = sanitizeSeverity(parsed.info.severity || parsed.severity);
        findings.push({
          finding_type: 'vulnerability',
          severity: sev,
          title: parsed.info.name || parsed.template_id || 'Nuclei finding',
          description: parsed.info.description,
          affected_host: parsed.host || parsed.ip,
          cve_id: parsed.info.classification?.cve_id?.[0],
          cvss_score: parsed.info.classification?.cvss_score,
          remediation: parsed.info.remediation,
          reference_urls: parsed.info.reference || [],
          evidence: parsed,
        });
      }
      // Amass format
      else if (tool.name === 'amass' && parsed.name) {
        findings.push({
          finding_type: 'subdomain',
          severity: 'info',
          title: parsed.name,
          affected_host: parsed.name,
          evidence: parsed,
        });
      }
      // Subfinder format
      else if (tool.name === 'subfinder' && parsed.host) {
        findings.push({
          finding_type: 'subdomain',
          severity: 'info',
          title: parsed.host,
          affected_host: parsed.host,
          evidence: parsed,
        });
      }
      // Masscan format
      else if (tool.name === 'masscan' && (parsed.ports || parsed.ip)) {
        const ports = parsed.ports || [];
        for (const p of ports) {
          findings.push({
            finding_type: 'open_port',
            severity: 'low',
            title: `Port ${p.port}/${p.proto || 'tcp'} open`,
            affected_host: parsed.ip,
            affected_port: p.port,
            evidence: parsed,
          });
        }
      }
      // httpx format
      else if (tool.name === 'httpx' && parsed.url) {
        findings.push({
          finding_type: 'service',
          severity: 'info',
          title: `HTTP service: ${parsed.url}`,
          affected_host: parsed.host || parsed.url,
          affected_port: parsed.port,
          evidence: parsed,
        });
      }
      // Generic JSON
      else {
        findings.push({
          finding_type: 'service',
          severity: 'info',
          title: tool.name + ' finding',
          evidence: parsed,
        });
      }
    } catch {
      // Skip non-JSON lines
    }
  }
  return findings;
}

function parseTextOutput(output: string, tool: ScoutTool): ParsedFinding[] {
  const findings: ParsedFinding[] = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    // For tools like shodan, censys, theHarvester; treat each line as a finding
    findings.push({
      finding_type: 'subdomain',
      severity: 'info',
      title: line.trim().slice(0, 200),
      evidence: { raw: line },
    });
  }
  return findings;
}

export async function processFindings(
  tool: ScoutTool,
  result: { output: string; error: string; exitCode: number },
  ctx: { scanRunId: string; targetId: string; workspaceId: string },
): Promise<ProcessResult> {
  let parsedFindings: ParsedFinding[] = [];

  // Parse based on output format
  switch (tool.outputParser) {
    case 'xml':
      parsedFindings = parseNmapXml(result.output, tool);
      break;
    case 'json':
      parsedFindings = parseJsonOutput(result.output, tool);
      break;
    case 'text':
    case 'lines':
    default:
      parsedFindings = parseTextOutput(result.output, tool);
      break;
  }

  let totalStored = 0;
  let newFindings = 0;

  for (const pf of parsedFindings) {
    const fingerprint = buildFingerprint(
      pf.finding_type,
      pf.affected_host || 'unknown',
      pf.affected_port,
      pf.title,
    );

    const severity = sanitizeSeverity(pf.severity);

    // Check for existing finding with same fingerprint
    const existing = await db('findings')
      .where({ fingerprint, target_id: ctx.targetId })
      .whereNotIn('status', ['false_positive', 'duplicate'])
      .first();

    if (existing) {
      // Update existing finding
      await db('findings').where({ id: existing.id }).update({
        last_seen_at: new Date().toISOString(),
        seen_count: (existing.seen_count || 1) + 1,
        evidence: pf.evidence,
        scan_run_id: ctx.scanRunId,
      });
      totalStored++;
    } else {
      // Insert new finding
      await db('findings').insert({
        scan_run_id: ctx.scanRunId,
        target_id: ctx.targetId,
        workspace_id: ctx.workspaceId,
        tool_name: tool.name,
        finding_type: pf.finding_type,
        severity,
        title: pf.title,
        description: pf.description || null,
        evidence: pf.evidence,
        affected_host: pf.affected_host || null,
        affected_port: pf.affected_port || null,
        cve_id: pf.cve_id || null,
        cvss_score: pf.cvss_score || null,
        cvss_vector: pf.cvss_vector || null,
        remediation: pf.remediation || null,
        reference_urls: pf.reference_urls || null,
        fingerprint,
        status: 'open',
      });
      totalStored++;
      newFindings++;
    }
  }

  // Also update discovered_assets for subdomains, IPs, services
  for (const pf of parsedFindings) {
    if (pf.affected_host) {
      const assetType = pf.finding_type === 'subdomain' ? 'subdomain'
        : pf.finding_type === 'open_port' ? 'service'
        : 'domain';

      await db('discovered_assets')
        .insert({
          workspace_id: ctx.workspaceId,
          asset_type: assetType,
          value: pf.affected_host,
          source_tool: tool.name,
          source_target_id: ctx.targetId,
          last_seen_at: new Date().toISOString(),
          metadata: pf.evidence,
        })
        .onConflict(['workspace_id', 'asset_type', 'value'])
        .merge({
          last_seen_at: new Date().toISOString(),
          metadata: pf.evidence,
        });
    }
  }

  return { total: totalStored, new_: newFindings };
}
