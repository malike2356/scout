// scout-engine/src/event-server/config.ts
// Event ingestion server configuration; reads from process.env after dotenv is loaded.
import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required env var: ${key}. See .env.example.`);
  }
  return val;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const serverConfig = {
  port: parseInt(optional('SCOUT_PORT', '4444'), 10),
  db: {
    url: optional('SCOUT_DATABASE_URL') || optional('DATABASE_URL')
         || 'postgresql://carina:***@localhost:5432/carina',
  },
  redis: {
    url: optional('REDIS_URL') || 'redis://localhost:6379',
  },
  auth: {
    apiKey: required('SCOUT_API_KEY'),
  },
} as const;
