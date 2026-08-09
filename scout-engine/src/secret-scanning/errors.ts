// scout-engine/src/secret-scanning/errors.ts
import crypto from 'crypto';
import type { Response } from 'express';

export function newCorrelationId(): string {
  return `ssc_${crypto.randomBytes(12).toString('hex')}`;
}

export function sendSecretScanError(
  res: Response,
  status: number,
  code: string,
  correlationId: string,
): void {
  res.status(status).json({
    error: code,
    correlation_id: correlationId,
  });
}
