import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import { buildStatusResponse } from './boundary/status.js';
import { listEvents } from './boundary/events.js';
import { eventsRouter } from '../event-server/api/events.js';
import { sseRouter } from '../event-server/api/sse.js';

export const customerRouter: ExpressRouter = Router();

customerRouter.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await buildStatusResponse());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[scout-engine:customer] Status failed:', msg);
    res.status(500).json({ error: 'Database unavailable' });
  }
});

customerRouter.get('/events', listEvents);
customerRouter.post('/events', eventsRouter);
customerRouter.use('/events/stream', sseRouter);
