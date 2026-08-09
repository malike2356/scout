// scout-engine/src/scoring/score-job.ts
// Hourly score calculation for all active workspaces
// Checks for score drops and generates alerts
import cron from 'node-cron';
import { db } from '../db/index.js';
import { calculateScoutScore, generateScoreDropReason } from './scout-score.js';

let scoreJob: cron.ScheduledTask | null = null;

export function startScoreJob(): void {
  if (scoreJob) return;

  console.log('[ScoreJob] Starting hourly score calculation...');

  // Run immediately on start
  calculateAllScores().catch(err => console.error('[ScoreJob] Initial calculation error:', err));

  // Then every hour (at minute 0)
  scoreJob = cron.schedule('0 * * * *', async () => {
    try {
      await calculateAllScores();
    } catch (err) {
      console.error('[ScoreJob] Error:', err);
    }
  });

  console.log('[ScoreJob] Score calculation running (every hour)');
}

export function stopScoreJob(): void {
  if (scoreJob) {
    scoreJob.stop();
    scoreJob = null;
    console.log('[ScoreJob] Stopped');
  }
}

async function calculateAllScores(): Promise<void> {
  const workspaces = await db('workspaces').where({ active: true });

  if (workspaces.length === 0) {
    // If no workspaces, create a default one
    try {
      await db('workspaces').insert({ id: 'default', name: 'Default Workspace', active: true }).onConflict('id').ignore();
      workspaces.push({ id: 'default', name: 'Default Workspace' });
    } catch {}
  }

  for (const ws of workspaces) {
    try {
      const score = await calculateScoutScore(ws.id);

      // Store score
      await db('scout_scores').insert({
        workspace_id: ws.id,
        total: score.total,
        categories: JSON.stringify(score.categories),
        weights: JSON.stringify(score.weights),
        finding_counts: JSON.stringify(score.findingCounts),
      });

      // Check for significant drops (>5 points)
      if (score.trend.direction === 'down' && Math.abs(score.trend.change) >= 5) {
        const reason = await generateScoreDropReason(ws.id, score);
        await db('score_alerts').insert({
          workspace_id: ws.id,
          previous_score: score.trend.previousScore,
          current_score: score.total,
          change: score.trend.change,
          reason,
        });

        console.log(`[ScoreJob] Score drop alert for workspace ${ws.id}: ${score.trend.previousScore} → ${score.total} (${reason})`);
      }
    } catch (err) {
      console.error(`[ScoreJob] Error calculating score for workspace ${ws.id}:`, err);
    }
  }
}
