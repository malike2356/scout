// scout-engine/src/event-server/redis.ts
// Redis pub/sub client for the event ingestion server.
import { Redis, type RedisOptions } from 'ioredis';
import { serverConfig } from './config.js';

function redisClientOptions(overrides: RedisOptions = {}): RedisOptions {
  return {
    retryStrategy: (times: number) => Math.min(times * 100, 30_000),
    enableReadyCheck: true,
    ...(process.env.REDIS_TLS === 'true'
      ? {
          tls: {
            rejectUnauthorized: process.env.NODE_ENV === 'production',
          },
        }
      : {}),
    ...overrides,
  };
}

let client: Redis | null = null;

export function initRedis(): Promise<void> {
  return new Promise((resolve) => {
    const r = new Redis(serverConfig.redis.url, redisClientOptions({
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    }));

    r.on('error', (err: Error) => {
      console.warn('[scout:redis] Connection error:', err.message);
    });

    r.connect()
      .then(() => {
        client = r;
        console.log('[scout:redis] Connected');
        resolve();
      })
      .catch(() => {
        console.warn('[scout:redis] Redis unavailable; event fan-out degraded');
        r.disconnect();
        resolve();
      });
  });
}

export function getRedis(): Redis | null {
  return client;
}

export function createSubscriber(): Redis {
  return new Redis(serverConfig.redis.url, redisClientOptions({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }));
}
