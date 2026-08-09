// scout-engine/src/event-server/api/sse.ts
// Server-Sent Events endpoint for real-time event streaming.
// GET /api/v1/events/stream; SSE stream of security events.
// No authentication required; intended for local network dashboard access.
import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';

export const sseRouter: ExpressRouter = Router();

// Connected SSE clients
const clients = new Set<Response>();

// Broadcast an event to all connected SSE clients
export function broadcastEvent(event: Record<string, unknown>): void {
  const data = JSON.stringify({ type: 'event', payload: event });
  for (const client of clients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

// Broadcast aggregate stats to all connected SSE clients
export function broadcastStats(stats: { critical: number; warning: number; info: number }): void {
  const data = JSON.stringify({ type: 'stats', payload: stats });
  for (const client of clients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

// Heartbeat to keep connections alive (every 30 seconds)
setInterval(() => {
  const heartbeat = JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() });
  for (const client of clients) {
    try {
      client.write(`data: ${heartbeat}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}, 30_000);

sseRouter.get('/', (req: Request, res: Response) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  // Register client
  clients.add(res);

  // Remove client on connection close
  req.on('close', () => {
    clients.delete(res);
  });
});
