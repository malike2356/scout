// scout-engine/src/alerts/delivery.ts
// Alert delivery: email, Telegram, Slack, webhook, push
import nodemailer from 'nodemailer';
import { db } from '../db/index.js';
import type { AlertRule } from './rules.js';

// ── Email Transport ──
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || '',
      } : undefined,
    });
  }
  return transporter;
}

// ── Types ──
export interface AlertData {
  finding?: any;
  score?: any;
  scanRun?: any;
  agent?: any;
  event?: string;
}

export interface DeliveryResult {
  channel: string;
  success: boolean;
  error?: string;
}

// ── Severity-based routing ──
const CRITICAL_SEVERITY = ['critical'];
const HIGH_SEVERITY = ['critical', 'high'];
const INSTANT_SEVERITIES = ['critical', 'high']; // immediate delivery
const DIGEST_SEVERITIES = ['medium', 'low', 'info']; // batched delivery

export function isInstantAlert(severity: string): boolean {
  return INSTANT_SEVERITIES.includes(severity);
}

export function isDigestAlert(severity: string): boolean {
  return DIGEST_SEVERITIES.includes(severity);
}

// ── Main delivery dispatcher ──
export async function deliverAlert(
  rule: AlertRule,
  data: AlertData,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  for (const channel of rule.channels) {
    let success = false;
    let error: string | undefined;

    try {
      switch (channel) {
        case 'email':
          await sendEmailAlert(rule, data);
          success = true;
          break;
        case 'telegram':
          await sendTelegramAlert(rule, data);
          success = true;
          break;
        case 'slack':
          await sendSlackAlert(rule, data);
          success = true;
          break;
        case 'push':
          await sendPushNotification(rule, data);
          success = true;
          break;
        case 'webhook':
          await sendWebhookAlert(rule, data);
          success = true;
          break;
        default:
          error = `Unknown channel: ${channel}`;
      }
    } catch (err: any) {
      error = err.message || String(err);
    }

    results.push({ channel, success, error });

    // Log to alert_history
    try {
      await db('alert_history').insert({
        workspace_id: rule.workspaceId,
        rule_id: rule.id,
        finding_id: data.finding?.id || null,
        channel,
        delivered: success,
        error: error || null,
      });
    } catch { /* non-critical */ }
  }

  return results;
}

// ════════════════════════════════════════════
// Email Delivery
// ════════════════════════════════════════════
async function sendEmailAlert(rule: AlertRule, data: AlertData): Promise<void> {
  const config = rule.config || {};
  const to = config.email || process.env.ALERT_EMAIL || 'admin@localhost';

  const finding = data.finding;
  const subject = finding
    ? `Scout Alert [${finding.severity?.toUpperCase()}]: ${finding.title?.slice(0, 80)}`
    : `Scout Alert: ${data.event || 'Security Event'}`;

  const html = buildAlertEmail(data);

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'scout@labyrinthscout.com',
    to,
    subject,
    html,
  });

  console.log(`[Alert] Email sent to ${to}: ${subject}`);
}

function buildAlertEmail(data: AlertData): string {
  const finding = data.finding;
  if (!finding) {
    return `<div style="font-family:-apple-system,sans-serif;max-width:600px">
      <div style="background:#4f46e5;color:white;padding:20px;border-radius:12px 12px 0 0">
        <h2 style="margin:0;font-size:20px">&#9878; Labyrinth Scout Alert</h2>
      </div>
      <div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="font-size:16px">${data.event || 'Security event detected'}</p>
        ${data.score ? `<p style="font-size:14px">Current Scout Score: <strong style="color:#4f46e5">${data.score.total}</strong></p>` : ''}
      </div>
    </div>`;
  }

  const severityColor: Record<string, string> = {
    critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#2563eb', info: '#6b7280',
  };

  return `<div style="font-family:-apple-system,sans-serif;max-width:600px">
    <div style="background:${severityColor[finding.severity] || '#6b7280'};color:white;padding:20px;border-radius:12px 12px 0 0">
      <h2 style="margin:0;font-size:18px">&#9888; ${finding.severity?.toUpperCase()} Finding</h2>
      <p style="margin:8px 0 0;font-size:15px;opacity:0.95">${finding.title}</p>
    </div>
    <div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
      ${finding.description ? `<p style="font-size:14px;color:#374151">${finding.description}</p>` : ''}
      <table style="width:100%;margin-top:12px;font-size:13px;border-collapse:collapse">
        ${finding.affected_host ? `<tr><td style="padding:4px 0;color:#6b7280">Host</td><td><strong>${finding.affected_host}</strong></td></tr>` : ''}
        ${finding.affected_port ? `<tr><td style="padding:4px 0;color:#6b7280">Port</td><td><strong>${finding.affected_port}</strong></td></tr>` : ''}
        ${finding.cve_id ? `<tr><td style="padding:4px 0;color:#6b7280">CVE</td><td><strong style="color:#dc2626">${finding.cve_id}</strong></td></tr>` : ''}
        ${finding.cvss_score ? `<tr><td style="padding:4px 0;color:#6b7280">CVSS</td><td><strong>${finding.cvss_score}</strong></td></tr>` : ''}
        ${finding.remediation ? `<tr><td style="padding:4px 0;color:#6b7280">Fix</td><td>${finding.remediation}</td></tr>` : ''}
      </table>
      <p style="color:#9ca3af;font-size:11px;margin-top:16px">
        Found by ${finding.tool_name || 'Scout'} | First seen ${new Date(finding.first_seen_at).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'})}
      </p>
      <a href="https://console.labyrinthscout.com/dashboard.html"
         style="display:inline-block;background:#4f46e5;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:8px;font-weight:600">
        View in Scout Dashboard
      </a>
    </div>
  </div>`;
}

// ════════════════════════════════════════════
// Telegram Delivery (Bot API)
// ════════════════════════════════════════════
async function sendTelegramAlert(rule: AlertRule, data: AlertData): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[Alert] Telegram bot token not configured (TELEGRAM_BOT_TOKEN)');
    return;
  }

  const config = rule.config || {};
  const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.warn('[Alert] No Telegram chat ID configured');
    return;
  }

  const finding = data.finding;
  const severityEmoji: Record<string, string> = {
    critical: '\u{1F534}', high: '\u{1F7E0}', medium: '\u{1F7E1}', low: '\u{1F535}', info: '\u26AA',
  };
  const emoji = severityEmoji[(finding?.severity || 'info')] || '\u26AA';

  let text = '';
  if (finding) {
    text = `${emoji} *Scout Alert: ${finding.severity?.toUpperCase()} Finding*\n\n`;
    text += `*${finding.title}*\n`;
    if (finding.cve_id) text += `CVE: \`${finding.cve_id}\`\n`;
    if (finding.cvss_score) text += `CVSS: *${finding.cvss_score}*\n`;
    if (finding.affected_host) text += `Host: \`${finding.affected_host}${finding.affected_port ? ':' + finding.affected_port : ''}\`\n`;
    if (finding.description) text += `\n_${finding.description.slice(0, 200)}_\n`;
    if (finding.remediation) text += `\n&#128736; Fix: ${finding.remediation.slice(0, 200)}\n`;
  } else {
    text = `${emoji} *Scout Alert*\n\n${data.event || 'Security event detected'}`;
    if (data.score) text += `\nScout Score: *${data.score.total}*`;
  }

  text += `\n[View Dashboard](https://console.labyrinthscout.com/dashboard.html)`;

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Telegram API error: ${response.status} ${errBody}`);
  }

  console.log(`[Alert] Telegram message sent to ${chatId}`);
}

// ════════════════════════════════════════════
// Slack Delivery (Block Kit formatting)
// ════════════════════════════════════════════
async function sendSlackAlert(rule: AlertRule, data: AlertData): Promise<void> {
  const config = rule.config || {};

  // Support multiple Slack config sources: direct webhook URL, or SLACK_WEBHOOK_URL env var
  const webhookUrl = config.webhookUrl || config.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[Alert] No Slack webhook URL configured');
    return;
  }

  const finding = data.finding;
  const severityColorMap: Record<string, string> = {
    critical: '#dc2626', high: '#ea580c', medium: '#eab308', low: '#3b82f6', info: '#6b7280',
  };
  const severityEmoji: Record<string, string> = {
    critical: ':red_circle:', high: ':large_orange_circle:', medium: ':large_yellow_circle:',
    low: ':large_blue_circle:', info: ':white_circle:',
  };

  const sev = finding?.severity || 'info';
  const color = severityColorMap[sev] || '#6b7280';
  const emoji = severityEmoji[sev] || ':white_circle:';

  // Build Slack Block Kit message
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} Scout Alert: ${sev.toUpperCase()} Finding`,
        emoji: true,
      },
    },
  ];

  if (finding) {
    // Title section
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${finding.title}*${finding.cve_id ? `  |  \`${finding.cve_id}\`` : ''}`,
      },
    });

    // Detail fields
    const fields: string[] = [];
    if (finding.cvss_score) fields.push(`*CVSS:* ${finding.cvss_score}`);
    if (finding.affected_host) fields.push(`*Host:* \`${finding.affected_host}${finding.affected_port ? ':' + finding.affected_port : ''}\``);
    if (finding.finding_type) fields.push(`*Type:* ${finding.finding_type}`);
    if (finding.tool_name) fields.push(`*Tool:* ${finding.tool_name}`);

    if (fields.length > 0) {
      blocks.push({
        type: 'section',
        fields: fields.map(f => ({ type: 'mrkdwn', text: f })),
      });
    }

    // Description
    if (finding.description) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `_${finding.description.slice(0, 300)}${finding.description.length > 300 ? '...' : ''}_`,
        },
      });
    }

    // Remediation
    if (finding.remediation) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:wrench: *Fix:* ${finding.remediation.slice(0, 300)}`,
        },
      });
    }
  } else if (data.score) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Score dropped! Current Scout Score: *${data.score.total}*`,
      },
    });
  }

  // Divider + actions
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `:shield: Labyrinth Scout | ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      },
    ],
  });

  const attachments = [{ color, blocks }];

  // For Slack incoming webhook, the payload format is different from chat.postMessage
  // Handle both Slack webhook URL formats
  const isIncomingWebhook = webhookUrl.includes('hooks.slack.com/services/');

  const payload = isIncomingWebhook
    ? { attachments }
    : {
        channel: config.slackChannel || process.env.SLACK_CHANNEL || '#security-alerts',
        attachments,
      };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Slack API error: ${response.status} ${errBody}`);
  }

  console.log(`[Alert] Slack message sent`);
}

// ════════════════════════════════════════════
// Webhook Delivery (generic)
// ════════════════════════════════════════════
async function sendWebhookAlert(rule: AlertRule, data: AlertData): Promise<void> {
  const config = rule.config || {};
  if (!config.webhookUrl) return;

  const payload = {
    event: data.event || 'finding_new',
    finding: data.finding,
    score: data.score,
    timestamp: new Date().toISOString(),
    workspaceId: rule.workspaceId,
  };

  await fetch(config.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Scout-Signature': config.webhookSecret || 'unsigned',
    },
    body: JSON.stringify(payload),
  });

  console.log(`[Alert] Webhook sent to ${config.webhookUrl}`);
}

// ════════════════════════════════════════════
// Push Notification (placeholder; Firebase/APNs)
// ════════════════════════════════════════════
async function sendPushNotification(_rule: AlertRule, data: AlertData): Promise<void> {
  console.log(`[Alert] Push notification: ${data.finding?.title || data.event || 'Alert'}`);
  // TODO: Integrate with Firebase Admin SDK or APNs
  // When integrated, use FCM token from rule.config.fcmToken
}

// ════════════════════════════════════════════
// Alert digest; batched emails for non-critical alerts
// ════════════════════════════════════════════
export async function buildDigestEmail(
  workspaceId: string,
  findings: any[],
  timeWindow: { start: Date; end: Date },
): Promise<string> {
  if (!findings.length) return '';

  const groupedBySeverity: Record<string, any[]> = {};
  for (const f of findings) {
    const sev = f.severity || 'info';
    if (!groupedBySeverity[sev]) groupedBySeverity[sev] = [];
    groupedBySeverity[sev].push(f);
  }

  const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
  const summaryRows = severityOrder
    .filter(s => groupedBySeverity[s])
    .map(s => `<tr><td style="color:${severityColor(s)};font-weight:700">${s.toUpperCase()}</td><td>${groupedBySeverity[s].length}</td></tr>`)
    .join('');

  const detailRows = findings.slice(0, 30).map(f => `
    <tr>
      <td><span style="color:${severityColor(f.severity)};font-weight:700">${f.severity?.toUpperCase()}</span></td>
      <td>${f.title?.slice(0, 80)}</td>
      <td>${f.affected_host || ';'}</td>
      <td>${f.cvss_score || ';'}</td>
    </tr>
  `).join('');

  const timeLabel = `${timeWindow.start.toLocaleDateString()} ${timeWindow.start.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} - ${timeWindow.end.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;

  return `<div style="font-family:-apple-system,sans-serif;max-width:600px">
    <div style="background:#4f46e5;color:white;padding:20px;border-radius:12px 12px 0 0">
      <h2 style="margin:0;font-size:18px">&#128240; Scout Security Digest</h2>
      <p style="margin:8px 0 0;opacity:0.85;font-size:13px">${timeLabel}</p>
    </div>
    <div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
      <h3 style="font-size:15px;margin-bottom:8px">Summary</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${summaryRows}
      </table>
      ${detailRows ? `
        <h3 style="font-size:15px;margin:20px 0 8px">Recent Findings</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <tr style="background:#f9fafb">
            <th style="text-align:left;padding:6px">Severity</th>
            <th style="text-align:left;padding:6px">Title</th>
            <th style="text-align:left;padding:6px">Host</th>
            <th style="text-align:left;padding:6px">CVSS</th>
          </tr>
          ${detailRows}
        </table>
      ` : ''}
      <a href="https://console.labyrinthscout.com/dashboard.html"
         style="display:inline-block;background:#4f46e5;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:16px;font-weight:600">
        View Full Dashboard
      </a>
    </div>
  </div>`;
}

function severityColor(severity: string): string {
  const colors: Record<string, string> = {
    critical: '#dc2626', high: '#ea580c', medium: '#eab308', low: '#3b82f6', info: '#6b7280',
  };
  return colors[severity] || '#6b7280';
}

// ════════════════════════════════════════════
// Alert suppression helpers
// ════════════════════════════════════════════
export async function isAlertMuted(
  workspaceId: string,
  findingId?: string,
  targetId?: string,
): Promise<boolean> {
  if (!findingId && !targetId) return false;

  try {
    const now = new Date();
    let query = db('alert_mutes').where('workspace_id', workspaceId).where('muted_until', '>', now);

    if (findingId) {
      const mute = await query.clone().where('finding_id', findingId).first();
      if (mute) return true;
    }
    if (targetId) {
      const mute = await db('alert_mutes').where('workspace_id', workspaceId).where('target_id', targetId).where('muted_until', '>', now).first();
      if (mute) return true;
    }
  } catch { /* if table doesn't exist yet, allow alerts */ }

  return false;
}

export async function isInDndWindow(workspaceId: string): Promise<boolean> {
  try {
    const dnd = await db('workspace_settings').where('workspace_id', workspaceId).first();
    if (!dnd?.dnd_enabled) return false;

    const dndStart = dnd.dnd_start_hour ?? 22;
    const dndEnd = dnd.dnd_end_hour ?? 7;
    const now = new Date();
    const hour = now.getHours();

    if (dndStart <= dndEnd) {
      return hour >= dndStart && hour < dndEnd;
    } else {
      return hour >= dndStart || hour < dndEnd;
    }
  } catch {
    return false;
  }
}
