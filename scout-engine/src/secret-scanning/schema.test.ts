// scout-engine/src/secret-scanning/schema.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { SECRET_SCAN_SCHEMA_VERSION } from './constants.js';
import { collectForbiddenKeys, validateSecretScanIngest } from './schema.js';
import {
  buildSignedIngestPayload,
  computeIngestSignature,
  bodyHashForSignature,
  verifyIngestSignature,
} from './signature.js';

const apiKey = 'sk_live_test_key_for_hmac_verification_only';

function baseUnsigned(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    schema_version: SECRET_SCAN_SCHEMA_VERSION,
    connector_key: 'repo-propreneur-v2',
    repository_alias: 'propreneur-v2',
    product: 'propreneur',
    scan_id: 'scan_test_1',
    mode: 'staged' as const,
    scanner_name: 'verlox-secrets',
    scanner_version: '1.0.0',
    started_at: now,
    completed_at: now,
    observed_at: now,
    status: 'completed' as const,
    counts: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
    findings: [
      {
        rule_id: 'stripe-live-key',
        severity: 'critical' as const,
        relative_path: 'config/services.php',
        line: 42,
        commit_id: 'abc1234',
        fingerprint: crypto.createHash('sha256').update('finding-1').digest('hex').slice(0, 32),
      },
    ],
    hook: { installed: true, last_check_at: now },
    environment_policy: { ok: true, detail: 'gitignore_ok' },
    idempotency_key: 'idem_' + crypto.randomBytes(12).toString('hex'),
    ...overrides,
  };
}

function signed(overrides: Record<string, unknown> = {}) {
  return buildSignedIngestPayload(apiKey, baseUnsigned(overrides) as any);
}

describe('secret-scan schema', () => {
  it('accepts a valid redacted fixture', () => {
    const result = validateSecretScanIngest(signed());
    assert.equal(result.ok, true);
  });

  it('rejects unknown fields', () => {
    const result = validateSecretScanIngest({ ...signed(), extra: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'invalid_schema');
  });

  it('rejects forbidden sensitive fields before schema parse', () => {
    const body = {
      ...signed(),
      findings: [
        {
          ...baseUnsigned().findings[0],
          match_text: 'sk_live_SHOULD_NOT_APPEAR',
        },
      ],
    };
    const forbidden = collectForbiddenKeys(body);
    assert.ok(forbidden.some((path) => path.includes('match_text')));
    const result = validateSecretScanIngest(body);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'forbidden_field');
  });

  it('rejects absolute paths', () => {
    const result = validateSecretScanIngest(
      signed({
        findings: [
          {
            ...baseUnsigned().findings[0],
            relative_path: '/opt/lampp/htdocs/secret.env',
          },
        ],
      }),
    );
    assert.equal(result.ok, false);
  });

  it('rejects count mismatches', () => {
    const result = validateSecretScanIngest(
      signed({
        counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      }),
    );
    assert.equal(result.ok, false);
  });
});

describe('secret-scan signatures', () => {
  it('verifies a correctly signed payload', () => {
    const payload = signed();
    const result = verifyIngestSignature({ apiKey, payload });
    assert.equal(result.ok, true);
  });

  it('rejects a malformed digest', () => {
    const payload = signed();
    payload.signature.digest = '00'.repeat(32);
    const result = verifyIngestSignature({ apiKey, payload });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'invalid_signature');
  });

  it('rejects timestamp skew', () => {
    const unsigned = baseUnsigned();
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const bodyHash = bodyHashForSignature(unsigned as any);
    const digest = computeIngestSignature({
      apiKey,
      timestamp: old,
      nonce: 'nonce12345678',
      idempotencyKey: unsigned.idempotency_key,
      bodyHash,
    });
    const payload = {
      ...unsigned,
      signature: {
        algorithm: 'hmac-sha256' as const,
        timestamp: old,
        nonce: 'nonce12345678',
        digest,
      },
    };
    const result = verifyIngestSignature({ apiKey, payload: payload as any });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'timestamp_skew');
  });
});
