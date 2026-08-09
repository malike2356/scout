// scout-engine/src/api/findings.ts
// Findings endpoints: query, paginate, filter, update status
import { Router, Request, Response, type Router as ExpressRouter } from 'express';
import { db } from '../db/index.js';

export const findingsRouter: ExpressRouter = Router();

// Severity ordering for sorting
const severityOrder: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

// ════════════════════════════════════════════
// List findings with filtering and pagination
// ════════════════════════════════════════════
findingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const {
      severity,
      status = 'open',
      type,
      target_id,
      limit = '50',
      offset = '0',
    } = req.query as any;

    let query = db('findings').where('workspace_id', workspaceId);
    if (severity) query = query.where('severity', severity);
    if (status && status !== 'all') query = query.where('status', status);
    if (type) query = query.where('finding_type', type);
    if (target_id) query = query.where('target_id', target_id);

    const totalRow = await query.clone().count('* as count').first();
    const findings = await query
      .orderBy('last_seen_at', 'desc')
      .limit(Math.min(parseInt(limit) || 50, 500))
      .offset(parseInt(offset) || 0);

    // Sort by severity first, then by last_seen_at
    findings.sort((a: any, b: any) => {
      const aOrd = severityOrder[a.severity] ?? 99;
      const bOrd = severityOrder[b.severity] ?? 99;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
    });

    res.json({
      findings,
      total: parseInt((totalRow?.count as string) || '0'),
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Get single finding by ID
// ════════════════════════════════════════════
findingsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const finding = await db('findings').where({ id: req.params.id }).first();
    if (!finding) return res.status(404).json({ error: 'Finding not found' });
    res.json({ finding });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Update finding status
// ════════════════════════════════════════════
findingsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { status: newStatus, resolved_by } = req.body;
    const valid = ['open', 'confirmed', 'false_positive', 'remediated', 'wont_fix', 'duplicate'];
    if (!newStatus || !valid.includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${valid.join(', ')}` });
    }

    const updates: any = { status: newStatus };
    if (['remediated', 'false_positive', 'wont_fix', 'duplicate'].includes(newStatus)) {
      updates.resolved_at = new Date().toISOString();
      updates.resolved_by = resolved_by || null;
    }

    const [finding] = await db('findings').where({ id: req.params.id }).update(updates).returning('*');
    if (!finding) return res.status(404).json({ error: 'Finding not found' });

    res.json({ finding });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Get finding counts by severity (summary)
// ════════════════════════════════════════════
findingsRouter.get('/summary/counts', async (req: Request, res: Response) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { status = 'open' } = req.query as any;

    let query = db('findings').where('workspace_id', workspaceId);
    if (status && status !== 'all') query = query.where('status', status);

    const rows = await query
      .select('severity')
      .count('* as count')
      .groupBy('severity');

    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const row of rows) {
      counts[row.severity as string] = parseInt(row.count as string);
    }

    res.json({ counts, status: status || 'open' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
