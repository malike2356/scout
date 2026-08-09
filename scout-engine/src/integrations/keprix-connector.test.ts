import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  KEPRIX_SENSORS,
  loadTargetsYaml,
  propagateKillToKeprix,
  resolveKeprixConfig,
} from './keprix-connector.js';
import { isKeprixAnomalyEventType } from '../alerts/keprix-anomaly.js';

describe('keprix-connector', () => {
  const prev = {
    KEPRIX_URL: process.env.KEPRIX_URL,
    KEPRIX_SCOUT_KILL_TOKEN: process.env.KEPRIX_SCOUT_KILL_TOKEN,
    CARINA_KEPRIX_SHARED_TOKEN: process.env.CARINA_KEPRIX_SHARED_TOKEN,
    SCOUT_TARGETS_CONFIG: process.env.SCOUT_TARGETS_CONFIG,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('loads keprix target from yaml with env expansion', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-keprix-'));
    const file = path.join(dir, 'targets.yaml');
    process.env.KEPRIX_URL = 'http://127.0.0.1:3333';
    process.env.KEPRIX_SCOUT_KILL_TOKEN = 'tok_test';
    fs.writeFileSync(
      file,
      `targets:
  keprix:
    type: keprix
    name: keprix-aiva
    url: \${KEPRIX_URL}
    auth_token: \${KEPRIX_SCOUT_KILL_TOKEN}
    kill_switch_enabled: true
    sensors:
      - keprix_prompt_sensor
`,
    );
    const cfg = loadTargetsYaml(file);
    assert.ok(cfg);
    assert.equal(cfg!.url, 'http://127.0.0.1:3333');
    assert.equal(cfg!.auth_token, 'tok_test');
    assert.equal(cfg!.name, 'keprix-aiva');
    assert.ok(cfg!.sensors?.includes('keprix_prompt_sensor'));
  });

  it('resolveKeprixConfig prefers explicit env overrides', () => {
    delete process.env.SCOUT_TARGETS_CONFIG;
    process.env.KEPRIX_URL = 'http://keprix.local:3333';
    process.env.KEPRIX_SCOUT_KILL_TOKEN = 'shared';
    const cfg = resolveKeprixConfig({ url: 'http://override:1', auth_token: 'override-tok' });
    assert.ok(cfg);
    assert.equal(cfg!.url, 'http://override:1');
    assert.equal(cfg!.auth_token, 'override-tok');
    assert.equal(cfg!.type, 'keprix');
  });

  it('exposes the four warden sensors', () => {
    assert.equal(KEPRIX_SENSORS.length, 4);
    assert.ok(KEPRIX_SENSORS.every((s) => s.id.startsWith('keprix_')));
  });

  it('propagates kill to Keprix within 2s timeout budget', async () => {
    process.env.KEPRIX_URL = 'http://127.0.0.1:3333';
    process.env.KEPRIX_SCOUT_KILL_TOKEN = 'tok';
    delete process.env.SCOUT_TARGETS_CONFIG;

    const originalFetch = globalThis.fetch;
    let seenUrl = '';
    let seenBody: Record<string, unknown> | null = null;
    globalThis.fetch = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seenBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({ ok: true, active: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const result = await propagateKillToKeprix({
        workspace_id: 'ws_1',
        scope: 'workspace',
        reason: 'test kill',
        activated_by: 'scout',
      });
      assert.equal(result.ok, true);
      assert.ok(result.latency_ms < 2000);
      assert.match(seenUrl, /\/keprix\/kill$/);
      assert.equal(seenBody?.workspace_id, 'ws_1');
      assert.equal(seenBody?.activated_by, 'scout');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('skips kill when kill switch is disabled on target', async () => {
    const result = await propagateKillToKeprix(
      { workspace_id: 'ws_1' },
      {
        url: 'http://127.0.0.1:3333',
        auth_token: 'tok',
        kill_switch_enabled: false,
        enabled: false,
      },
    );
    assert.equal(result.skipped, true);
    assert.equal(result.ok, true);
  });
});

describe('keprix anomaly helpers', () => {
  it('detects blocked and anomaly event types', () => {
    assert.equal(isKeprixAnomalyEventType('prompt_blocked'), true);
    assert.equal(isKeprixAnomalyEventType('anomaly'), true);
    assert.equal(isKeprixAnomalyEventType('keprix_prompt_blocked'), true);
    assert.equal(isKeprixAnomalyEventType('tool_complete'), false);
  });
});
