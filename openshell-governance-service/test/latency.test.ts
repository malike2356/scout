// 10,000 decisions against a loaded snapshot; assert p99 < 25ms and
// max < 100ms. The second, more important assertion: zero database round
// trips during evaluation, proven by an instrumented pool's query counter,
// not merely claimed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/policy/decide.js";
import { getQueryCount, resetQueryCount } from "../src/policy/db.js";
import type { LoadedPolicy, PolicyBinding, PolicySnapshot } from "../src/policy/types.js";

function buildSnapshot(): PolicySnapshot {
  const policy: LoadedPolicy = {
    id: "1",
    policySlug: "baseline-sandbox",
    version: 1,
    digestSha256: "digest-baseline-sandbox",
    document: {
      rules: [
        {
          id: "deny-forbidden-label",
          rpc: "CreateSandbox",
          when: { path: "/labels/scout-forbidden", op: "equals", value: "true" },
          verdict: "deny",
          reason: "label scout-forbidden=true is blocked",
        },
      ],
      defaultVerdict: "allow",
  middlewareRules: [],
  middlewareDefaultVerdict: "allow",
      patches: [{ rpc: "CreateSandbox", op: "add", path: "/labels/scout-governed", value: "true" }],
    },
  };
  const bindings: PolicyBinding[] = [{ subjectKind: "global", subjectKey: "*", policyId: "1", priority: 100 }];
  return { loadedAt: new Date().toISOString(), policiesById: new Map([["1", policy]]), bindings };
}

test("p99 decision latency is under 25ms and max under 100ms over 10,000 decisions", () => {
  const snapshot = buildSnapshot();
  const count = 10_000;
  const durationsMs: number[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const forbidden = i % 7 === 0; // mix of allow/deny so neither branch is starved
    const start = performance.now();
    decide(
      {
        rpc: "openshell.v1.OpenShell/CreateSandbox",
        phase: "validate",
        subject: { tenantId: "default" },
        operation: { labels: forbidden ? { "scout-forbidden": "true" } : {} },
      },
      snapshot,
    );
    durationsMs[i] = performance.now() - start;
  }

  durationsMs.sort((a, b) => a - b);
  const p99 = durationsMs[Math.floor(count * 0.99)];
  const max = durationsMs[count - 1];
  console.log(JSON.stringify({ p99_ms: p99, max_ms: max, decisions: count }));

  assert.ok(p99 < 25, `p99 ${p99}ms must be under 25ms`);
  assert.ok(max < 100, `max ${max}ms must be under 100ms`);
});

test("zero database round trips occur during evaluation", () => {
  const snapshot = buildSnapshot();
  resetQueryCount();

  for (let i = 0; i < 1_000; i++) {
    decide(
      {
        rpc: "openshell.v1.OpenShell/CreateSandbox",
        phase: "validate",
        subject: { tenantId: "default" },
        operation: {},
      },
      snapshot,
    );
  }

  const queries = getQueryCount();
  console.log(JSON.stringify({ queries_during_evaluation: queries }));
  assert.equal(queries, 0, "decide() must perform zero database queries");
});
