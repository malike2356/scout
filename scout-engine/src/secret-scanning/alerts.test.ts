import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRedactedSecretAlertPayload } from './alerts.js';
import { assertNoProhibitedExport, displaySafePath, stripForbiddenFields } from './redact.js';

describe('secret-scan alert redaction', () => {
  it('builds alerts without prohibited fields or credential-shaped values', () => {
    const payload = buildRedactedSecretAlertPayload({
      repositoryAlias: 'keprix',
      finding: {
        id: 'f1',
        scoutFindingId: 's1',
        severity: 'critical',
        ruleId: 'stripe-live-key',
        relativePath: 'config/services.php',
        line: 12,
        isReopen: true,
      },
    });
    const json = JSON.stringify(payload);
    assert.equal('match_text' in payload, false);
    assert.equal('evidence' in payload, false);
    assert.ok(!json.includes('sk_live_'));
    assert.ok(json.includes('keprix'));
    assert.ok(json.includes('finding reopened'));
  });
});

describe('secret-scan export redaction', () => {
  it('strips forbidden keys and rejects credential-shaped exports', () => {
    const cleaned = stripForbiddenFields({
      rule_id: 'x',
      match_text: 'nope',
      secret: 'nope',
    }) as Record<string, unknown>;
    assert.equal('match_text' in cleaned, false);
    assert.equal(displaySafePath('/abs/path'), 'location withheld');
    assert.throws(() =>
      assertNoProhibitedExport({ findings: [{ match_text: 'x', value: 'sk_live_abc' }] }),
    );
  });
});
