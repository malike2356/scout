// scout-engine/src/engine/scan-runner.ts
// Orchestrates a full scan: executes all active tools against a target
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { SCOUT_TOOLS, getActiveScanTools, type ScoutTool } from '../tools/registry.js';
import { processFindings } from './finding-processor.js';

const execAsync = promisify(exec);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface ScanContext {
  scanRunId: string;
  targetId: string;
  workspaceId: string;
  targetValue: string;
  targetType: string;
  /** If true, use fast subset of tools (for onboarding) */
  fastMode?: boolean;
}

export async function runScan(ctx: ScanContext): Promise<void> {
  // Mark scan as running
  await db('scan_runs').where({ id: ctx.scanRunId }).update({
    status: 'running',
    started_at: new Date().toISOString(),
  });

  const tools = ctx.fastMode
    ? SCOUT_TOOLS.filter(t => ['nmap', 'whatweb', 'httpx', 'sslscan', 'dnsrecon', 'shodan', 'subfinder', 'amass', 'testssl', 'nuclei'].includes(t.name))
        .sort((a, b) => a.priority - b.priority)
    : SCOUT_TOOLS
        .filter(t => t.priority < 99 && t.timeout > 0) // Skip daemon/continuous tools
        .sort((a, b) => a.priority - b.priority);

  let toolsRun = 0;
  let toolsFailed = 0;
  let totalFindings = 0;
  let newFindings = 0;

  for (const tool of tools) {
    // Skip tools that don't match this target's format
    if (tool.requiresTargetFormat && tool.requiresTargetFormat !== ctx.targetType) {
      continue;
    }

    try {
      const result = await executeTool(tool, ctx);
      toolsRun++;

      if (tool.producesFindings && result.output) {
        const processed = await processFindings(tool, result, ctx);
        totalFindings += processed.total;
        newFindings += processed.new_;
      }
    } catch (err: any) {
      toolsFailed++;
      console.error(`Tool ${tool.name} failed for target ${ctx.targetValue}:`, err.message);
      try {
        await db('tool_executions').insert({
          scan_run_id: ctx.scanRunId,
          tool_name: tool.name,
          tool_category: tool.category,
          status: 'failed',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          exit_code: -1,
          raw_error: (err.message || String(err)).slice(0, 10000),
        });
      } catch {}
    }

    // Rate limiting between tools
    if (tool.rateLimit.delayBetweenTargets > 0) {
      await sleep(tool.rateLimit.delayBetweenTargets);
    }
  }

  // Mark scan as completed
  const scanRun = await db('scan_runs').where({ id: ctx.scanRunId }).first();
  const startTime = scanRun?.started_at ? new Date(scanRun.started_at).getTime() : Date.now();

  await db('scan_runs').where({ id: ctx.scanRunId }).update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    tools_run: toolsRun,
    tools_failed: toolsFailed,
    findings_total: totalFindings,
    findings_new: newFindings,
  });

  // Update target's last scan time
  await db('targets').where({ id: ctx.targetId }).update({
    last_scan_at: new Date().toISOString(),
  });
}

async function executeTool(
  tool: ScoutTool,
  ctx: ScanContext,
): Promise<{ output: string; error: string; exitCode: number; durationMs: number }> {
  const executionId = crypto.randomUUID();
  const command = tool.command.replace(/\{target\}/g, ctx.targetValue);

  await db('tool_executions').insert({
    id: executionId,
    scan_run_id: ctx.scanRunId,
    tool_name: tool.name,
    tool_category: tool.category,
    status: 'running',
    started_at: new Date().toISOString(),
  });

  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: tool.timeout > 0 ? tool.timeout * 1000 : undefined,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
    });

    const durationMs = Date.now() - startTime;

    await db('tool_executions').where({ id: executionId }).update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      exit_code: 0,
      raw_output: stdout.slice(0, 100000), // Store first 100KB
      raw_error: stderr?.slice(0, 10000) || null,
    });

    return { output: stdout, error: stderr || '', exitCode: 0, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;

    await db('tool_executions').where({ id: executionId }).update({
      status: err.killed ? 'timed_out' : 'failed',
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      exit_code: err.code || -1,
      raw_error: (err.stderr || err.message || String(err)).slice(0, 10000),
    });

    throw err;
  }
}
