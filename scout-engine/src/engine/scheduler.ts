// scout-engine/src/engine/scheduler.ts
// Cron-based scan scheduling: checks for targets due and runs them
import { db } from '../db/index.js';
import { runScan } from './scan-runner.js';

let cronJob: ReturnType<typeof setInterval> | null = null;

// Poll every 30 seconds for targets that need scanning
export function startScheduler(): void {
  if (cronJob) return;

  console.log('[Scheduler] Starting scan scheduler (checks every 30s)...');

  cronJob = setInterval(async () => {
    try {
      const dueTargets = await db('targets')
        .where({ enabled: true })
        .where(function() {
          this.where('next_scan_at', '<=', new Date().toISOString())
            .orWhereNull('next_scan_at');
        })
        .limit(3); // Process max 3 targets per tick to avoid overload

      if (dueTargets.length > 0) {
        console.log(`[Scheduler] Found ${dueTargets.length} target(s) due for scanning`);
      }

      for (const target of dueTargets) {
        await scheduleTargetScan(target);
      }
    } catch (err) {
      console.error('[Scheduler] Error:', err);
    }
  }, 30_000);

  console.log('[Scheduler] Scan scheduler running');
}

export function stopScheduler(): void {
  if (cronJob) {
    clearInterval(cronJob);
    cronJob = null;
    console.log('[Scheduler] Scan scheduler stopped');
  }
}

async function scheduleTargetScan(target: any): Promise<void> {
  // Create scan run
  const [scanRun] = await db('scan_runs')
    .insert({
      target_id: target.id,
      workspace_id: target.workspace_id,
      status: 'pending',
    })
    .returning('*');

  console.log(`[Scheduler] Starting scan for target ${target.name} (${target.value})`);

  // Run scan (fire and forget; scheduler continues to next target)
  runScan({
    scanRunId: scanRun.id,
    targetId: target.id,
    workspaceId: target.workspace_id,
    targetValue: target.value,
    targetType: target.type,
  }).catch(err => {
    console.error(`[Scheduler] Scan failed for target ${target.id}:`, err.message);
    db('scan_runs').where({ id: scanRun.id }).update({
      status: 'failed',
      error: err.message?.slice(0, 500),
      completed_at: new Date().toISOString(),
    }).catch(() => {});
  });

  // Schedule next scan
  await scheduleNextScan(target);
}

export async function scheduleNextScan(targetId: string): Promise<void> {
  const target = await db('targets').where({ id: targetId }).first();
  if (!target) return;

  const intervals: Record<string, number> = {
    hourly: 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  };

  const nextScan = new Date(Date.now() + (intervals[target.schedule] || intervals.weekly));

  await db('targets').where({ id: targetId }).update({
    next_scan_at: nextScan.toISOString(),
  });
}

/** Trigger an immediate scan for a target (manual trigger) */
export async function triggerManualScan(
  targetId: string,
  options: { fastMode?: boolean } = {},
): Promise<string> {
  const target = await db('targets').where({ id: targetId }).first();
  if (!target) throw new Error('Target not found');
  if (!target.enabled) throw new Error('Target is disabled');

  const [scanRun] = await db('scan_runs')
    .insert({
      target_id: target.id,
      workspace_id: target.workspace_id,
      status: 'pending',
    })
    .returning('*');

  runScan({
    scanRunId: scanRun.id,
    targetId: target.id,
    workspaceId: target.workspace_id,
    targetValue: target.value,
    targetType: target.type,
    fastMode: options.fastMode,
  }).catch(err => {
    console.error(`[Scheduler] Manual scan failed for target ${target.id}:`, err.message);
    db('scan_runs').where({ id: scanRun.id }).update({
      status: 'failed',
      error: err.message?.slice(0, 500),
      completed_at: new Date().toISOString(),
    }).catch(() => {});
  });

  // Still schedule next periodic scan
  await scheduleNextScan(target.id);

  return scanRun.id;
}
