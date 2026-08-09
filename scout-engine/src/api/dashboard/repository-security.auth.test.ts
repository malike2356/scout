// scout-engine/src/api/dashboard/repository-security.auth.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

describe('dashboard repository-security router auth wiring', () => {
  it('is mounted after dashboardAuthMiddleware', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), 'index.ts');
    const source = readFileSync(root, 'utf8');
    const authIdx = source.indexOf('dashboardRouter.use(dashboardAuthMiddleware)');
    const mountIdx = source.indexOf('dashboardRouter.use(dashboardRepositorySecurityRouter)');
    assert.ok(authIdx >= 0);
    assert.ok(mountIdx > authIdx);
  });

  it('does not expose ingest on the dashboard router', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'repository-security.ts');
    const source = readFileSync(file, 'utf8');
    assert.equal(source.includes("post('/repository-secret-scans'"), false);
    assert.equal(source.includes('ingestSecretScan'), false);
    assert.ok(source.includes("'/repository-security/overview'"));
    assert.ok(source.includes('transitionRemediation'));
  });
});
