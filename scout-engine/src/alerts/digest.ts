// scout-engine/src/alerts/digest.ts
// Alert digest engine; batches non-critical alerts into periodic digest emails
import { db } from '../db/index.js';
import { getMatchingRules, partitionRulesByDelivery, type AlertRule } from './rules.js';
import { buildDigestEmail } from './delivery.js';
import nodemailer from 'nodemailer';

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || '',
      } : undefined,
    });
  }
  return _transporter;
}

export interface DigestWindow {
  start: Date;
  end: Date;
}

/**
 * Run digest for a workspace; collects findings since the last digest
 * and sends a summarized email if there are any.
 */
export async function runDigest(
  workspaceId: string,
  window?: DigestWindow,
): Promise<{ sent: boolean; findingCount: number }> {
  const end = window?.end || new Date();
  // Default window: last 4 hours
  const start = window?.start || new Date(end.getTime() - 4 * 60 * 60 * 1000);

  // Find all digest-mode rules for this workspace
  const rules = await getMatchingRules(workspaceId, 'finding_new', 'medium');

  if (!rules.length) {
    console.log(`[Digest] No digest rules for workspace ${workspaceId}`);
    return { sent: false, findingCount: 0 };
  }

  // Get findings since the last digest window
  const findings = await db('findings')
    .where('workspace_id', workspaceId)
    .where('status', 'open')
    .whereRaw('first_seen_at >= ? AND first_seen_at <= ?', [start.toISOString(), end.toISOString()])
    .orderBy('severity', 'asc')
    .orderBy('first_seen_at', 'desc')
    .limit(100);

  if (!findings.length) {
    console.log(`[Digest] No new findings for workspace ${workspaceId} since ${start.toISOString()}`);
    return { sent: false, findingCount: 0 };
  }

  // Filter: only non-critical findings for digest (critical should be instant)
  const digestFindings = findings.filter((f: any) =>
    !['critical', 'high'].includes(f.severity)
  );

  if (!digestFindings.length) {
    return { sent: false, findingCount: 0 };
  }

  // Build and send digest email
  const html = await buildDigestEmail(workspaceId, digestFindings, { start, end });
  if (!html) return { sent: false, findingCount: 0 };

  // Get workspace email config
  const wsSettings = await db('workspace_settings')
    .where('workspace_id', workspaceId)
    .first()
    .catch(() => null);

  const to = wsSettings?.alert_email || process.env.ALERT_EMAIL || 'admin@localhost';

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || 'scout@labyrinthscout.com',
      to,
      subject: `Scout Digest: ${digestFindings.length} findings (${start.toLocaleDateString()})`,
      html,
    });

    // Log to alert history
    for (const rule of rules) {
      for (const finding of digestFindings.slice(0, 10)) {
        try {
          await db('alert_history').insert({
            workspace_id: workspaceId,
            rule_id: rule.id,
            finding_id: finding.id,
            channel: 'email',
            delivered: true,
          });
        } catch { /* skip */ }
      }
    }

    console.log(`[Digest] Sent digest for workspace ${workspaceId}: ${digestFindings.length} findings`);
    return { sent: true, findingCount: digestFindings.length };
  } catch (err: any) {
    console.error(`[Digest] Failed to send digest for workspace ${workspaceId}:`, err.message);
    return { sent: false, findingCount: 0 };
  }
}

/**
 * Run digests for all workspaces that have digest rules configured.
 * Called by the scheduler every 4 hours.
 */
export async function runAllDigests(): Promise<void> {
  console.log('[Digest] Starting digest run for all workspaces...');

  try {
    const workspaces = await db('workspaces').select('id');
    for (const ws of workspaces) {
      try {
        await runDigest(ws.id);
      } catch (err: any) {
        console.error(`[Digest] Error for workspace ${ws.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[Digest] Error fetching workspaces:', err.message);
  }

  console.log('[Digest] Digest run complete');
}

/**
 * Start the digest scheduler; runs every 4 hours by default.
 * Uses setInterval. For production, consider node-cron with persistence.
 */
export function startDigestScheduler(): void {
  const intervalMs = parseInt(process.env.DIGEST_INTERVAL_MINUTES || '240') * 60 * 1000;
  console.log(`[Digest] Scheduler started; running every ${intervalMs / 60000} minutes`);

  // Run once on startup (after a short delay)
  setTimeout(() => runAllDigests(), 30000);

  // Run periodically
  setInterval(() => runAllDigests(), intervalMs);
}
