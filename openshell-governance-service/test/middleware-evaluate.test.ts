// Pure unit tests for src/middleware/evaluate.ts. No database, no gateway,
// no sandbox - synthetic snapshots only, mirroring test/decide.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateHttpRequest,
  evaluateWebSocketSession,
  evaluatePreReturn,
} from "../src/middleware/evaluate.js";
import type { LoadedPolicy, PolicyBinding, PolicySnapshot } from "../src/policy/types.js";

function policyWith(overrides: Partial<LoadedPolicy["document"]> = {}): LoadedPolicy {
  return {
    id: "1",
    policySlug: "baseline-sandbox",
    version: 1,
    digestSha256: "digest-baseline-sandbox",
    document: {
      rules: [],
      defaultVerdict: "allow",
      patches: [],
      middlewareRules: [
        {
          id: "deny-internal-host",
          operation: "http_request",
          when: { path: "/url", op: "equals", value: "https://internal.example/secrets" },
          verdict: "deny",
          reason: "egress to internal.example is blocked by policy baseline-sandbox v1",
        },
        {
          id: "redact-x-trace-header",
          operation: "http_request",
          when: { path: "/headers/x-trace-sentinel", op: "exists" },
          verdict: "redact",
          reason: "x-trace-sentinel header redacted by policy baseline-sandbox v1",
          redaction: { header: ["x-trace-sentinel"] },
        },
      ],
      middlewareDefaultVerdict: "allow",
      ...overrides,
    },
  };
}

function snapshotOf(policy: LoadedPolicy, bindings: PolicyBinding[]): PolicySnapshot {
  return { loadedAt: "2026-10-25T00:00:00.000Z", policiesById: new Map([["1", policy]]), bindings };
}

const GLOBAL_BINDING: PolicyBinding = { subjectKind: "global", subjectKey: "*", policyId: "1", priority: 100 };

test("evaluateHttpRequest denies when a rule matches and cites the same digest as the control plane", () => {
  const snapshot = snapshotOf(policyWith(), [GLOBAL_BINDING]);
  const decision = evaluateHttpRequest(
    {
      subject: { tenantId: "default" },
      method: "GET",
      url: "https://internal.example/secrets",
      headers: {},
      bodySizeBytes: 0,
    },
    snapshot,
    262_144,
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.policyDigest, "digest-baseline-sandbox");
  assert.equal(decision.ruleId, "deny-internal-host");
});

test("evaluateHttpRequest allows and records a header redaction by name only, never by value", () => {
  const snapshot = snapshotOf(policyWith(), [GLOBAL_BINDING]);
  const decision = evaluateHttpRequest(
    {
      subject: { tenantId: "default" },
      method: "GET",
      url: "https://example.com/ok",
      headers: { "x-trace-sentinel": "SENTINEL-VALUE-should-never-appear-anywhere" },
      bodySizeBytes: 0,
    },
    snapshot,
    262_144,
  );
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.redaction, { header: ["x-trace-sentinel"] });
  const serialized = JSON.stringify(decision);
  assert.ok(
    !serialized.includes("SENTINEL-VALUE-should-never-appear-anywhere"),
    "the decision object must never carry the redacted value, only the field name",
  );
});

test("evaluateHttpRequest fails closed if a credential header is present, asserting absence rather than stripping it", () => {
  const snapshot = snapshotOf(policyWith(), [GLOBAL_BINDING]);
  const decision = evaluateHttpRequest(
    {
      subject: { tenantId: "default" },
      method: "GET",
      url: "https://example.com/ok",
      headers: { authorization: "Bearer should-never-reach-scout" },
      bodySizeBytes: 0,
    },
    snapshot,
    262_144,
  );
  assert.equal(decision.verdict, "deny");
  assert.ok(!JSON.stringify(decision).includes("should-never-reach-scout"));
  assert.match(decision.reason, /credential header 'authorization'/);
});

test("evaluateHttpRequest enforces the payload ceiling, not merely declares it", () => {
  const snapshot = snapshotOf(policyWith(), [GLOBAL_BINDING]);
  const decision = evaluateHttpRequest(
    {
      subject: { tenantId: "default" },
      method: "POST",
      url: "https://example.com/upload",
      headers: {},
      bodySizeBytes: 300_000,
    },
    snapshot,
    262_144,
  );
  assert.equal(decision.verdict, "deny");
  assert.match(decision.reason, /300000 bytes exceeds the 262144-byte payload ceiling/);
});

test("evaluatePreReturn enforces the response payload ceiling", () => {
  const snapshot = snapshotOf(policyWith(), [GLOBAL_BINDING]);
  const decision = evaluatePreReturn(
    { subject: { tenantId: "default" }, statusCode: 200, headers: {}, bodySizeBytes: 500_000 },
    snapshot,
    262_144,
  );
  assert.equal(decision.verdict, "deny");
  assert.match(decision.reason, /500000 bytes exceeds the 262144-byte payload ceiling/);
});

test("evaluateWebSocketSession evaluates the session descriptor only, with no per-frame claim implied", () => {
  const snapshot = snapshotOf(policyWith(), [GLOBAL_BINDING]);
  const decision = evaluateWebSocketSession(
    { subject: { tenantId: "default" }, url: "wss://example.com/socket", headers: {} },
    snapshot,
  );
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.policyDigest, "digest-baseline-sandbox");
});

test("no resolvable binding fails closed, same discipline as the control plane", () => {
  const snapshot = snapshotOf(policyWith(), []);
  const decision = evaluateHttpRequest(
    { subject: { tenantId: "default" }, method: "GET", url: "https://example.com", headers: {}, bodySizeBytes: 0 },
    snapshot,
    262_144,
  );
  assert.equal(decision.verdict, "deny");
  assert.match(decision.reason, /no policy binding resolved/);
});
