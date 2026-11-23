// Pure unit tests for decide() and resolveBinding(). No database, no
// gateway - synthetic snapshots only, per the prompt's own requirement that
// the decision function be deterministic and testable without I/O.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/policy/decide.js";
import { resolveBinding } from "../src/policy/resolve-binding.js";
import type {
  BoundaryRequest,
  LoadedPolicy,
  PolicyBinding,
  PolicyDocument,
  PolicySnapshot,
} from "../src/policy/types.js";

function policyDoc(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return {
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
    patches: [
      { rpc: "CreateSandbox", op: "add", path: "/labels/scout-governed", value: "true" },
    ],
    ...overrides,
  };
}

function loadedPolicy(id: string, slug: string, overrides: Partial<PolicyDocument> = {}): LoadedPolicy {
  return { id, policySlug: slug, version: 1, digestSha256: `digest-${slug}`, document: policyDoc(overrides) };
}

function snapshotOf(policies: LoadedPolicy[], bindings: PolicyBinding[]): PolicySnapshot {
  const policiesById = new Map(policies.map((p) => [p.id, p]));
  return { loadedAt: "2026-10-25T00:00:00.000Z", policiesById, bindings };
}

function request(overrides: Partial<BoundaryRequest> = {}): BoundaryRequest {
  return {
    rpc: "openshell.v1.OpenShell/CreateSandbox",
    phase: "validate",
    subject: { tenantId: "default" },
    operation: {},
    ...overrides,
  };
}

test("denies when a rule matches, citing policySlug, policyDigest and reason", () => {
  const baseline = loadedPolicy("1", "baseline-sandbox");
  const snapshot = snapshotOf(
    [baseline],
    [{ subjectKind: "global", subjectKey: "*", policyId: "1", priority: 100 }],
  );
  const decision = decide(
    request({ operation: { labels: { "scout-forbidden": "true" } } }),
    snapshot,
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.policySlug, "baseline-sandbox");
  assert.equal(decision.policyDigest, "digest-baseline-sandbox");
  assert.equal(decision.ruleId, "deny-forbidden-label");
  assert.match(decision.reason, /blocked/);
});

test("allows with the default verdict when no rule matches", () => {
  const baseline = loadedPolicy("1", "baseline-sandbox");
  const snapshot = snapshotOf(
    [baseline],
    [{ subjectKind: "global", subjectKey: "*", policyId: "1", priority: 100 }],
  );
  const decision = decide(request({ operation: { labels: {} } }), snapshot);
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.ruleId, undefined);
});

test("modify_operation applies the permitted patch and creates the missing parent object", () => {
  const baseline = loadedPolicy("1", "baseline-sandbox");
  const snapshot = snapshotOf(
    [baseline],
    [{ subjectKind: "global", subjectKey: "*", policyId: "1", priority: 100 }],
  );
  const decision = decide(
    request({ phase: "modify_operation", operation: {} }),
    snapshot,
  );
  assert.equal(decision.verdict, "allow");
  assert.deepEqual(decision.patches, [{ op: "add", path: "/labels", value: { "scout-governed": "true" } }]);
});

test("modify_operation patches the leaf directly when the parent object already exists", () => {
  const baseline = loadedPolicy("1", "baseline-sandbox");
  const snapshot = snapshotOf(
    [baseline],
    [{ subjectKind: "global", subjectKey: "*", policyId: "1", priority: 100 }],
  );
  const decision = decide(
    request({ phase: "modify_operation", operation: { labels: { team: "scout" } } }),
    snapshot,
  );
  assert.deepEqual(decision.patches, [
    { op: "add", path: "/labels/scout-governed", value: "true" },
  ]);
});

test("a denying rule never returns patches, even at modify_operation", () => {
  const baseline = loadedPolicy("1", "baseline-sandbox");
  const snapshot = snapshotOf(
    [baseline],
    [{ subjectKind: "global", subjectKey: "*", policyId: "1", priority: 100 }],
  );
  const decision = decide(
    request({ phase: "modify_operation", operation: { labels: { "scout-forbidden": "true" } } }),
    snapshot,
  );
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.patches, undefined);
});

test("post_commit always allows and records which rule matched, never fails closed", () => {
  const baseline = loadedPolicy("1", "baseline-sandbox");
  const snapshot = snapshotOf(
    [baseline],
    [{ subjectKind: "global", subjectKey: "*", policyId: "1", priority: 100 }],
  );
  const decision = decide(
    request({ phase: "post_commit", operation: { labels: { "scout-forbidden": "true" } } }),
    snapshot,
  );
  assert.equal(decision.verdict, "allow");
  assert.equal(decision.ruleId, "deny-forbidden-label");
  assert.match(decision.reason, /post_commit record/);
});

test("no resolvable binding fails closed at validate, not silently allow", () => {
  const snapshot = snapshotOf([], []);
  const decision = decide(request(), snapshot);
  assert.equal(decision.verdict, "deny");
  assert.match(decision.reason, /no policy binding resolved/);
});

test("no resolvable binding fails open at post_commit, since the operation already committed", () => {
  const snapshot = snapshotOf([], []);
  const decision = decide(request({ phase: "post_commit" }), snapshot);
  assert.equal(decision.verdict, "allow");
});

test("a binding referencing a policy id missing from the snapshot fails closed at validate", () => {
  const snapshot = snapshotOf(
    [],
    [{ subjectKind: "global", subjectKey: "*", policyId: "missing-id", priority: 100 }],
  );
  const decision = decide(request(), snapshot);
  assert.equal(decision.verdict, "deny");
  assert.match(decision.reason, /not present in the loaded snapshot/);
});

test("binding precedence: workspace beats tenant, policy and global, one level at a time", () => {
  const globalPolicy: PolicyBinding = { subjectKind: "global", subjectKey: "*", policyId: "p-global", priority: 100 };
  const policyPolicy: PolicyBinding = { subjectKind: "policy", subjectKey: "regulated-eu", policyId: "p-policy", priority: 100 };
  const tenantPolicy: PolicyBinding = { subjectKind: "tenant", subjectKey: "tenant-a", policyId: "p-tenant", priority: 100 };
  const workspacePolicy: PolicyBinding = { subjectKind: "workspace", subjectKey: "ws-1", policyId: "p-workspace", priority: 100 };

  const req = request({
    subject: { tenantId: "tenant-a", workspaceId: "ws-1" },
    operation: { sandboxPolicyName: "regulated-eu" },
  });

  // Only global exists -> global wins.
  assert.equal(resolveBinding([globalPolicy], req)?.policyId, "p-global");
  // policy added -> policy beats global.
  assert.equal(resolveBinding([globalPolicy, policyPolicy], req)?.policyId, "p-policy");
  // tenant added -> tenant beats policy and global.
  assert.equal(resolveBinding([globalPolicy, policyPolicy, tenantPolicy], req)?.policyId, "p-tenant");
  // workspace added -> workspace beats tenant, policy and global.
  assert.equal(
    resolveBinding([globalPolicy, policyPolicy, tenantPolicy, workspacePolicy], req)?.policyId,
    "p-workspace",
  );
});

test("binding resolution has exactly one implementation reused by decide()", () => {
  // decide.ts must not re-derive precedence itself - it only calls
  // resolveBinding(). Exercised indirectly: a request whose only matching
  // binding is at tenant level resolves through decide() to that policy.
  const tenantPolicy = loadedPolicy("p-tenant", "tenant-policy");
  const snapshot = snapshotOf(
    [tenantPolicy],
    [{ subjectKind: "tenant", subjectKey: "tenant-a", policyId: "p-tenant", priority: 100 }],
  );
  const decision = decide(request({ subject: { tenantId: "tenant-a" } }), snapshot);
  assert.equal(decision.policySlug, "tenant-policy");
});
