// scout-engine/src/agents/suspicious-detector.ts
// Detects suspicious patterns in agent tool execution events
import { db } from '../db/index.js';
import type { AgentEvent } from './event-ingest.js';

interface SuspiciousResult {
  isSuspicious: boolean;
  findings: string[];
  pattern?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

// Suspicious behavior patterns
const SUSPICIOUS_PATTERNS = [
  {
    name: 'rapid_tool_execution',
    check: async (event: AgentEvent): Promise<boolean> => {
      if (event.eventType !== 'tool_complete') return false;
      const recent = await db('agent_events')
        .where({ agent_id: event.agentId, event_type: 'tool_complete' })
        .where('occurred_at', '>', db.raw("NOW() - INTERVAL '60 seconds'"))
        .count('* as count')
        .first();
      return parseInt(recent?.count as string || '0') > 10;
    },
    severity: 'medium' as const,
  },
  {
    name: 'credential_access',
    check: async (event: AgentEvent): Promise<boolean> => {
      const dangerousTools = ['mimikatz', 'secretdump', 'lazagne', 'hashdump', 'mimipenguin'];
      const dangerousPatterns = ['.env', 'credentials', '.secrets', 'id_rsa', '.pem', 'password'];
      if (!event.toolName) return false;

      if (dangerousTools.some(t => event.toolName!.toLowerCase().includes(t))) return true;

      const args = JSON.stringify(event.toolArgs || {}).toLowerCase();
      if (dangerousPatterns.some(p => args.includes(p))) return true;

      return false;
    },
    severity: 'critical' as const,
  },
  {
    name: 'exfiltration_pattern',
    check: async (event: AgentEvent): Promise<boolean> => {
      if (!event.toolName) return false;
      const exfilTools = ['curl', 'wget', 'nc', 'netcat', 'scp', 'ftp', 'rsync'];
      if (!exfilTools.includes(event.toolName.toLowerCase())) return false;

      // Check if output looks like it's uploading files
      const result = JSON.stringify(event.toolResult || {}).toLowerCase();
      const uploadIndicators = ['--upload-file', '-f', 'put', 'send', 'upload'];
      return uploadIndicators.some(i => result.includes(i));
    },
    severity: 'critical' as const,
  },
  {
    name: 'lateral_movement',
    check: async (event: AgentEvent): Promise<boolean> => {
      if (!event.toolName) return false;
      const lateralTools = ['ssh', 'wmiexec', 'psexec', 'rdp', 'vnc'];
      return lateralTools.includes(event.toolName.toLowerCase());
    },
    severity: 'high' as const,
  },
  {
    name: 'dangerous_hours',
    check: async (event: AgentEvent): Promise<boolean> => {
      const dangerousTools = ['metasploit', 'msfconsole', 'msfvenom', 'exploit', 'payload'];
      if (!event.toolName || !dangerousTools.some(t => event.toolName!.toLowerCase().includes(t))) return false;

      const settings = await db('workspace_settings')
        .where({ workspace_id: event.workspaceId })
        .first();
      const timezone = settings?.timezone
        ?? process.env.SCOUT_DEFAULT_TIMEZONE
        ?? 'UTC';
      const { localHourFromTimestamp, isDangerousLocalHour } = await import('../lib/workspace-time.js');
      const hour = localHourFromTimestamp(event.timestamp, timezone);
      return isDangerousLocalHour(hour);
    },
    severity: 'high' as const,
  },
  {
    name: 'first_time_dangerous',
    check: async (event: AgentEvent): Promise<boolean> => {
      if (!event.toolName) return false;
      const dangerousTools = ['nmap', 'nikto', 'sqlmap', 'hydra', 'burp', 'zap', 'metasploit'];
      if (!dangerousTools.some(t => event.toolName!.toLowerCase().includes(t))) return false;

      const previous = await db('agent_events')
        .where({ agent_id: event.agentId, tool_name: event.toolName })
        .where('id', '!=', db.raw('(SELECT id FROM agent_events ORDER BY occurred_at DESC LIMIT 1)'))
        .first();

      return !previous;
    },
    severity: 'low' as const,
  },
];

export async function detectSuspicious(event: AgentEvent): Promise<SuspiciousResult> {
  if (event.eventType !== 'tool_complete' && event.eventType !== 'tool_start') {
    return { isSuspicious: false, findings: [] };
  }

  const triggeredFindings: string[] = [];
  let highestSeverity = 'low';

  for (const pattern of SUSPICIOUS_PATTERNS) {
    try {
      const matched = await pattern.check(event);
      if (matched) {
        triggeredFindings.push(pattern.name);

        // Create finding
        const [finding] = await db('findings')
          .insert({
            scan_run_id: null as any,
            target_id: null as any,
            workspace_id: event.workspaceId,
            tool_name: event.toolName || 'agent_monitor',
            finding_type: 'suspicious_activity',
            severity: pattern.severity,
            title: `Suspicious activity: ${pattern.name} by agent ${event.agentId}`,
            description: `Agent ${event.agentId} (${event.agentType}) triggered suspicious pattern: ${pattern.name}`,
            fingerprint: `${event.agentId}-${pattern.name}-${Date.now()}`,
            evidence: {
              pattern: pattern.name,
              severity: pattern.severity,
              toolName: event.toolName,
              toolArgs: event.toolArgs,
              eventType: event.eventType,
              timestamp: event.timestamp,
            },
            status: 'open',
          })
          .returning('id');

        triggeredFindings.push(finding.id);

        if (pattern.severity === 'critical') highestSeverity = 'critical';
        else if (pattern.severity === 'high' && highestSeverity !== 'critical') highestSeverity = 'high';
        else if (pattern.severity === 'medium' && highestSeverity === 'low') highestSeverity = 'medium';
      }
    } catch (err) {
      console.error(`[SuspiciousDetector] Error checking pattern ${pattern.name}:`, err);
    }
  }

  return {
    isSuspicious: triggeredFindings.length > 0,
    findings: triggeredFindings,
    pattern: triggeredFindings.join(', '),
    severity: highestSeverity as any,
  };
}

export { SUSPICIOUS_PATTERNS };
