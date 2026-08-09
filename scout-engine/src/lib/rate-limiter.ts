// scout-engine/src/lib/rate-limiter.ts
// Per-organization, per-minute rate limiting backed by Redis. Falls back to an
// in-memory, best-effort counter (soft limit, always allows) when REDIS_URL is unset,
// so the public API keeps working in local/dev setups without Redis.
import Redis from 'ioredis';
import type { NextFunction, Request, Response } from 'express';
import { getPlanLimits } from './plans.js';

const WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

let redisClient: Redis | null | undefined;

function getRedisClient(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    redisClient = null;
    return redisClient;
  }

  const client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false });
  client.on('error', (err) => {
    console.warn('[scout:rate-limiter] Redis error:', err.message);
  });
  redisClient = client;
  return redisClient;
}

const memoryCounters = new Map<string, { count: number; resetAt: number }>();

function windowBounds(nowSeconds: number): { windowStart: number; resetAt: number } {
  const windowStart = Math.floor(nowSeconds / WINDOW_SECONDS) * WINDOW_SECONDS;
  return { windowStart, resetAt: windowStart + WINDOW_SECONDS };
}

export async function checkRateLimit(organizationId: string, plan: string): Promise<RateLimitResult> {
  const limit = getPlanLimits(plan).rpm;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const { windowStart, resetAt } = windowBounds(nowSeconds);

  const redis = getRedisClient();
  if (!redis) {
    const key = `${organizationId}:${windowStart}`;
    for (const [existingKey, value] of memoryCounters) {
      if (value.resetAt <= nowSeconds) memoryCounters.delete(existingKey);
    }
    const existing = memoryCounters.get(key);
    const count = (existing?.count ?? 0) + 1;
    memoryCounters.set(key, { count, resetAt });
    return { allowed: true, limit, remaining: Math.max(limit - count, 0), resetAt };
  }

  const redisKey = `scout:ratelimit:${organizationId}:${windowStart}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, WINDOW_SECONDS + 5);
    }
    return { allowed: count <= limit, limit, remaining: Math.max(limit - count, 0), resetAt };
  } catch (err) {
    console.warn('[scout:rate-limiter] Redis incr failed, allowing request:', (err as Error).message);
    return { allowed: true, limit, remaining: limit, resetAt };
  }
}

interface RateLimitedRequest extends Request {
  organizationId?: string;
  organization?: { plan?: string } & Record<string, unknown>;
}

export function rateLimitMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantReq = req as RateLimitedRequest;
    const organizationId = tenantReq.organizationId;
    if (!organizationId) {
      next();
      return;
    }

    const plan = tenantReq.organization?.plan ?? 'free';
    const result = await checkRateLimit(organizationId, String(plan));

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(result.resetAt));

    if (!result.allowed) {
      const retryAfter = Math.max(result.resetAt - Math.floor(Date.now() / 1000), 1);
      res.status(429).json({
        error: 'rate_limited',
        message: 'Rate limit exceeded for your plan.',
        retry_after: retryAfter,
      });
      return;
    }

    next();
  };
}
