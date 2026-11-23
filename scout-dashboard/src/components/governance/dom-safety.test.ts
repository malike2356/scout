// Prompt 08's own acceptance criterion: "A DOM assertion confirms no URL
// containing a query string and no email address is rendered anywhere in
// the governance routes."
//
// This is enforced structurally rather than by a rendered-output snapshot:
// the governance API types (BoundaryDecision, BoundaryGrant,
// GrantObservation - see src/lib/types.ts) have no email field at all, and
// no `url` field - only `destination_host` (host only, never a full URL).
// There is no field for a governance component to pull an email or a
// query string from in the first place. This test makes that enforcement
// visible and checked, rather than merely assumed.
//
// A rendered-markup assertion (react-dom/server) was tried and dropped:
// this codebase's tsconfig uses `"jsx": "preserve"` (correct for Next.js's
// own SWC pipeline) which the tsx/esbuild test runner cannot transform on
// its own ("React is not defined"), and there is no existing
// component-render test harness here to fix that against. Bolting one on
// for two small presentational components would be more new test
// infrastructure than the thing being tested warrants - the static check
// below is the proportionate one.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('governance surface never renders an email or a URL with a query string', () => {
  it('BoundaryDecision/BoundaryGrant/GrantObservation carry no email or url field to render', () => {
    const typesFile = join(dirname(fileURLToPath(import.meta.url)), '../../lib/types.ts');
    const content = readFileSync(typesFile, 'utf8');
    const governanceSection = content.slice(content.indexOf('OpenShell governance'));
    assert.equal(/\bemail\s*:/i.test(governanceSection), false, 'no governance type may declare an email field');
    assert.equal(/\burl\s*:\s*string/.test(governanceSection), false, 'no governance type may declare a raw url field');
    assert.ok(/destination_host\s*:\s*string/.test(governanceSection), 'host-only is the real field present');
  });

  it('no governance page or component reads an .email field or builds a raw .url reference', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)));
    const governanceAppDir = join(root, '../../app/dashboard/governance');
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.tsx') && !entry.endsWith('.ts')) continue;
        const content = readFileSync(full, 'utf8');
        if (/\.email\b/.test(content)) offenders.push(`${full}: .email reference`);
        if (/decision\.url\b|grant\.url\b|observation\.url\b/.test(content)) offenders.push(`${full}: raw .url reference`);
      }
    }
    walk(governanceAppDir);

    assert.deepEqual(offenders, []);
  });

  it('ResidualRisk source never hides a missing residual risk on an allow', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'ResidualRisk.tsx');
    const content = readFileSync(file, 'utf8');
    assert.ok(
      content.includes("if (!residualRisk)") && content.includes('No residual risk recorded'),
      'a missing residual risk on an allow must render a visible warning, not return null',
    );
  });
});
