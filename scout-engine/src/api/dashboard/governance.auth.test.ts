// scout-engine/src/api/dashboard/governance.auth.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

describe('dashboard governance router auth wiring', () => {
  it('is mounted after dashboardAuthMiddleware', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), 'index.ts');
    const source = readFileSync(root, 'utf8');
    const authIdx = source.indexOf('dashboardRouter.use(dashboardAuthMiddleware)');
    const mountIdx = source.indexOf('dashboardRouter.use(dashboardGovernanceRouter)');
    assert.ok(authIdx >= 0);
    assert.ok(mountIdx > authIdx, 'the governance router must be mounted after auth is required');
  });

  it('revoke always derives author from the authenticated session, never a client-supplied field', () => {
    const sourceFile = join(dirname(fileURLToPath(import.meta.url)), 'governance.ts');
    const source = readFileSync(sourceFile, 'utf8');
    assert.equal(source.includes('req.body?.author'), false, 'author must never come from the request body');
    assert.equal(source.includes('req.body.author'), false, 'author must never come from the request body');
    assert.ok(source.includes('dashboardReq.email || dashboardReq.userId'));
  });
});
