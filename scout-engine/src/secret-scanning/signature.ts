// scout-engine/src/secret-scanning/signature.ts
import crypto from 'crypto';
import { TIMESTAMP_SKEW_MS } from './constants.js';
import type { SecretScanIngestPayload } from './schema.js';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function bodyHashForSignature(payload: Omit<SecretScanIngestPayload, 'signature'>): string {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function computeIngestSignature(params: {
  apiKey: string;
  timestamp: string;
  nonce: string;
  idempotencyKey: string;
  bodyHash: string;
}): string {
  const material = `${params.timestamp}\n${params.nonce}\n${params.idempotencyKey}\n${params.bodyHash}`;
  return crypto.createHmac('sha256', params.apiKey).update(material).digest('hex');
}

export function verifyIngestSignature(params: {
  apiKey: string;
  payload: SecretScanIngestPayload;
  nowMs?: number;
}): { ok: true } | { ok: false; code: 'timestamp_skew' | 'invalid_signature' } {
  const now = params.nowMs ?? Date.now();
  const ts = Date.parse(params.payload.signature.timestamp);
  if (Number.isNaN(ts) || Math.abs(now - ts) > TIMESTAMP_SKEW_MS) {
    return { ok: false, code: 'timestamp_skew' };
  }

  const { signature, ...unsigned } = params.payload;
  const expected = computeIngestSignature({
    apiKey: params.apiKey,
    timestamp: signature.timestamp,
    nonce: signature.nonce,
    idempotencyKey: params.payload.idempotency_key,
    bodyHash: bodyHashForSignature(unsigned),
  });

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature.digest, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: 'invalid_signature' };
  }
  return { ok: true };
}

export function buildSignedIngestPayload(
  apiKey: string,
  unsigned: Omit<SecretScanIngestPayload, 'signature'>,
  options?: { timestamp?: string; nonce?: string },
): SecretScanIngestPayload {
  const timestamp = options?.timestamp ?? new Date().toISOString();
  const nonce = options?.nonce ?? crypto.randomBytes(16).toString('hex');
  const digest = computeIngestSignature({
    apiKey,
    timestamp,
    nonce,
    idempotencyKey: unsigned.idempotency_key,
    bodyHash: bodyHashForSignature(unsigned),
  });
  return {
    ...unsigned,
    signature: {
      algorithm: 'hmac-sha256',
      timestamp,
      nonce,
      digest,
    },
  };
}
