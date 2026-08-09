// scout-engine/src/event-server/middleware/auth.ts
// API key authentication middleware using constant-time comparison.
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { serverConfig } from '../config.js';

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-scout-key'];
  if (!key || typeof key !== 'string') {
    res.status(401).json({ error: 'Unauthorized: missing X-Scout-Key header' });
    return;
  }

  const expectedKey = serverConfig.auth.apiKey;
  const keyBuf = Buffer.from(key);
  const expectedBuf = Buffer.from(expectedKey);

  // Constant-time comparison prevents timing attacks
  if (keyBuf.length !== expectedBuf.length) {
    res.status(401).json({ error: 'Unauthorized: invalid X-Scout-Key' });
    return;
  }

  if (!timingSafeEqual(keyBuf, expectedBuf)) {
    res.status(401).json({ error: 'Unauthorized: invalid X-Scout-Key' });
    return;
  }

  next();
}
