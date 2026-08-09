import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayPath,
  sanitizeRepoSecurityValue,
  isForbiddenDisplayKey,
} from './sanitize-repo-security.js';

describe('sanitizeRepoSecurityValue', () => {
  it('strips forbidden secret-like keys from malformed payloads', () => {
    const sanitized = sanitizeRepoSecurityValue({
      rule_id: 'stripe',
      match_text: 'sk_live_SHOULD_NOT_RENDER',
      secret: 'leak',
      relative_path: 'src/config.ts',
      author_email: 'dev@example.com',
    }) as Record<string, unknown>;

    assert.equal(sanitized.rule_id, 'stripe');
    assert.equal(sanitized.relative_path, 'src/config.ts');
    assert.equal('match_text' in sanitized, false);
    assert.equal('secret' in sanitized, false);
    assert.equal('author_email' in sanitized, false);
  });

  it('redacts absolute paths and stray emails but keeps remediation actors', () => {
    const sanitized = sanitizeRepoSecurityValue({
      relative_path: '/opt/lampp/htdocs/secret.env',
      note: 'ops@verlox.uk',
      actor: 'ops@verlox.uk',
    }) as Record<string, unknown>;

    assert.equal(sanitized.relative_path, '[redacted-path]');
    assert.equal(sanitized.note, '[redacted-email]');
    assert.equal(sanitized.actor, 'ops@verlox.uk');
  });

  it('detects forbidden display keys', () => {
    assert.equal(isForbiddenDisplayKey('match_text'), true);
    assert.equal(isForbiddenDisplayKey('rule_id'), false);
  });

  it('formats display paths safely', () => {
    assert.equal(displayPath('app/config.ts'), 'app/config.ts');
    assert.equal(displayPath('app/config.ts', 'basename'), 'config.ts');
    assert.equal(displayPath('/abs/path'), 'location withheld');
  });
});
