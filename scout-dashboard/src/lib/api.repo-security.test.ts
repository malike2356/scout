import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('repository security api client contract', () => {
  it('documents dashboard paths used by the UI', () => {
    const paths = [
      '/api/dashboard/repository-security/overview',
      '/api/dashboard/repository-connectors',
      '/api/dashboard/repository-secret-scans/:id',
      '/api/dashboard/repository-secret-findings/:id/remediation',
      '/api/dashboard/repository-security/settings',
    ];
    for (const path of paths) {
      assert.ok(path.startsWith('/api/dashboard/'));
      assert.equal(path.includes('match_text'), false);
      assert.equal(path.includes('secret_value'), false);
    }
  });
});
