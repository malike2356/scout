// scout-engine/src/api/targets.ts
// Target CRUD endpoints: register, list, update, delete, trigger scans
import { Router, Request, Response, type Router as ExpressRouter } from 'express';
import { db } from '../db/index.js';
import { triggerManualScan } from '../engine/scheduler.js';
import { createDefaultRules } from '../alerts/rules.js';

export const targetsRouter: ExpressRouter = Router();

// ════════════════════════════════════════════
// List targets for workspace
// ════════════════════════════════════════════
targetsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const targets = await db('targets')
      .where({ workspace_id: workspaceId })
      .orderBy('created_at', 'desc');
    res.json({ targets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Register a new target
// ════════════════════════════════════════════
targetsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { name, type, value, schedule = 'weekly' } = req.body;

    if (!name || !type || !value) {
      return res.status(400).json({ error: 'name, type, and value are required' });
    }

    const validTypes = ['domain', 'ip', 'ip_range', 'url'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const validSchedules = ['hourly', 'daily', 'weekly', 'monthly'];
    if (!validSchedules.includes(schedule)) {
      return res.status(400).json({ error: `schedule must be one of: ${validSchedules.join(', ')}` });
    }

    // Ensure workspace exists
    const ws = await db('workspaces').where({ id: workspaceId }).first();
    if (!ws) await db('workspaces').insert({ id: workspaceId, name: 'Default Workspace' });

    // Create default alert rules for new workspace
    await createDefaultRules(workspaceId).catch(() => {});

    const [target] = await db('targets')
      .insert({
        workspace_id: workspaceId,
        name,
        type,
        value,
        schedule,
        next_scan_at: new Date().toISOString(), // Eligible immediately
      })
      .returning('*');

    let scanRunId: string | undefined;
    if (req.body.onboarding === true || req.body.start_fast_scan === true) {
      scanRunId = await triggerManualScan(target.id, { fastMode: true });
    }

    res.status(201).json({ target, scan_run_id: scanRunId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Get single target
// ════════════════════════════════════════════
targetsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const target = await db('targets').where({ id: req.params.id }).first();
    if (!target) return res.status(404).json({ error: 'Target not found' });
    res.json({ target });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Update target (name, schedule, enabled, scan_config)
// ════════════════════════════════════════════
targetsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, schedule, enabled, scan_config } = req.body;
    const updates: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (schedule !== undefined) updates.schedule = schedule;
    if (enabled !== undefined) updates.enabled = enabled;
    if (scan_config !== undefined) updates.scan_config = scan_config;

    const [target] = await db('targets').where({ id: req.params.id }).update(updates).returning('*');
    if (!target) return res.status(404).json({ error: 'Target not found' });
    res.json({ target });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Delete target
// ════════════════════════════════════════════
targetsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await db('targets').where({ id: req.params.id }).delete();
    if (!deleted) return res.status(404).json({ error: 'Target not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Trigger manual scan for a target
// ════════════════════════════════════════════
targetsRouter.post('/:id/scan', async (req: Request, res: Response) => {
  try {
    const fastMode = req.body?.fast_mode === true || req.query.fast_mode === 'true';
    const scanRunId = await triggerManualScan(req.params.id, { fastMode });
    res.json({ scan_run_id: scanRunId, status: 'started', fast_mode: fastMode });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
