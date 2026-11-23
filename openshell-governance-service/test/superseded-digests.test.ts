// Fast, synchronous: supersededDigests() is the one place "what counts as
// superseded" is decided, feeding prompt 06's grant-closing-on-reload path
// (see index.ts's closeSupersededGrants). No database needed - plain
// PolicySnapshot objects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { supersededDigests } from "../src/policy/snapshot.js";
import type { LoadedPolicy, PolicySnapshot } from "../src/policy/types.js";

function policy(overrides: Partial<LoadedPolicy> = {}): LoadedPolicy {
  return {
    id: "1",
    policySlug: "baseline",
    version: 1,
    digestSha256: "digest-v1",
    document: { rules: [], defaultVerdict: "deny", patches: [], middlewareRules: [], middlewareDefaultVerdict: "deny" },
    ...overrides,
  };
}

function snapshot(policies: LoadedPolicy[]): PolicySnapshot {
  const policiesById = new Map(policies.map((p) => [p.id, p]));
  return { loadedAt: new Date().toISOString(), policiesById, bindings: [] };
}

test("a policy whose digest changed under the same slug is reported superseded", () => {
  const previous = snapshot([policy({ digestSha256: "digest-v1" })]);
  const next = snapshot([policy({ digestSha256: "digest-v2" })]);
  assert.deepEqual(supersededDigests(previous, next), ["digest-v1"]);
});

test("an unchanged digest is never reported superseded", () => {
  const previous = snapshot([policy({ digestSha256: "digest-v1" })]);
  const next = snapshot([policy({ digestSha256: "digest-v1" })]);
  assert.deepEqual(supersededDigests(previous, next), []);
});

test("a policy slug that disappears entirely (not merely re-digested) is not reported superseded here", () => {
  // Disappearance is a different event than supersession - this function
  // only reports "still exists under this slug, but under a new digest".
  const previous = snapshot([policy({ policySlug: "retired", digestSha256: "digest-old" })]);
  const next = snapshot([]);
  assert.deepEqual(supersededDigests(previous, next), []);
});

test("multiple superseded slugs are all reported", () => {
  const previous = snapshot([
    policy({ id: "1", policySlug: "a", digestSha256: "a-v1" }),
    policy({ id: "2", policySlug: "b", digestSha256: "b-v1" }),
  ]);
  const next = snapshot([
    policy({ id: "1", policySlug: "a", digestSha256: "a-v2" }),
    policy({ id: "2", policySlug: "b", digestSha256: "b-v2" }),
  ]);
  assert.deepEqual(new Set(supersededDigests(previous, next)), new Set(["a-v1", "b-v1"]));
});
