// scout-engine/src/api/scans.ts
// Scan endpoints: list scan history, get scan detail with tool executions
import { Router, Request, Response, type Router as ExpressRouter } from 'express';
import { db } from '../db/index.js';

export const scansRouter: ExpressRouter = Router();

// ════════════════════════════════════════════
// List scan runs with pagination
// ════════════════════════════════════════════
scansRouter.get('/', async (req: Request, res: Response) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { target_id, status, limit = '20', offset = '0' } = req.query as any;

    let query = db('scan_runs').where('workspace_id', workspaceId);
    if (target_id) query = query.where('target_id', target_id);
    if (status) query = query.where('status', status);

    const total = await query.clone().count('* as count').first();
    const scans = await query
      .orderBy('created_at', 'desc')
      .limit(Math.min(parseInt(limit) || 20, 100))
      .offset(parseInt(offset) || 0);

    res.json({
      scans,
      total: parseInt((total?.count as string) || '0'),
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Get scan detail with tool executions
// ════════════════════════════════════════════
scansRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const scan = await db('scan_runs').where({ id: req.params.id }).first();
    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    const toolExecutions = await db('tool_executions')
      .where({ scan_run_id: req.params.id })
      .orderBy('created_at', 'asc');

    // Also get findings from this scan
    const findingsSummary = await db('findings')
      .where({ scan_run_id: req.params.id })
      .select('severity')
      .count('* as count')
      .groupBy('severity');

    res.json({
      scan,
      tool_executions: toolExecutions,
      findings_summary: findingsSummary,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Get tool executions for a specific scan
// ════════════════════════════════════════════
scansRouter.get('/:id/tools', async (req: Request, res: Response) => {
  try {
    const scan = await db('scan_runs').where({ id: req.params.id }).first();
    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    const tools = await db('tool_executions')
      .where({ scan_run_id: req.params.id })
      .orderBy('created_at', 'asc');

    res.json({ scan_id: req.params.id, tool_executions: tools });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
