import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDangerousLocalHour, localHourFromTimestamp } from './workspace-time.js';

describe('workspace-time', () => {
  it('converts UTC timestamps to workspace local hour', () => {
    const hour = localHourFromTimestamp('2026-06-21T06:20:00.000Z', 'Europe/London');
    assert.equal(hour, 7);
  });

  it('does not flag daytime activity in Europe/London', () => {
    const hour = localHourFromTimestamp('2026-06-21T06:20:00.000Z', 'Europe/London');
    assert.equal(isDangerousLocalHour(hour), false);
  });

  it('flags late-night hours in workspace timezone', () => {
    assert.equal(isDangerousLocalHour(23), true);
    assert.equal(isDangerousLocalHour(3), true);
    assert.equal(isDangerousLocalHour(12), false);
  });
});
