// Test-only instrumentation, same justification as config.ts's
// debugProtocolMajorOverride: exists solely to produce the
// credential-invisibility test's required evidence (prompt 04) - "a
// recording wrapper on the service handler stores raw request bytes."
// Gated by an env var that is never set outside that test. Appends the
// exact bytes this service received, before any processing, to a file the
// test reads back afterward.

import { appendFileSync } from "node:fs";

export function recordRawRequestIfEnabled(label: string, raw: unknown): void {
  const path = process.env.SCOUT_TEST_RECORD_RAW_REQUESTS_PATH;
  if (!path) return;
  appendFileSync(path, `${JSON.stringify({ label, raw })}\n`);
}
