// Prompt 06's own pitfall: "which observations belong to which grant" must
// be one tested function, not re-derived per query. Fast, synchronous, no
// database - attribute.ts takes plain objects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { attributesTo } from "../src/linkage/attribute.js";
import { capabilityContains } from "../src/linkage/capability.js";
import type { BoundaryGrant, RawObservation } from "../src/linkage/types.js";

function grant(overrides: Partial<BoundaryGrant> = {}): BoundaryGrant {
  return {
    id: "1",
    sandboxId: "sbx-1",
    capability: "*",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    ...overrides,
  };
}

function obs(overrides: Partial<RawObservation> = {}): RawObservation {
  return {
    sandboxId: "sbx-1",
    observedAt: "2026-01-01T00:00:00.000Z",
    capability: "*",
    ...overrides,
  };
}

test("a different sandbox never attributes, regardless of window or capability", () => {
  assert.equal(attributesTo(obs({ sandboxId: "sbx-2" }), grant({ sandboxId: "sbx-1" })), false);
});

test("exactly at effective_from attributes", () => {
  const g = grant({ effectiveFrom: "2026-01-01T00:00:00.000Z" });
  assert.equal(attributesTo(obs({ observedAt: "2026-01-01T00:00:00.000Z" }), g), true);
});

test("one millisecond before effective_from does not attribute", () => {
  const g = grant({ effectiveFrom: "2026-01-01T00:00:00.000Z" });
  assert.equal(attributesTo(obs({ observedAt: "2025-12-31T23:59:59.999Z" }), g), false);
});

test("one millisecond after effective_from attributes", () => {
  const g = grant({ effectiveFrom: "2026-01-01T00:00:00.000Z" });
  assert.equal(attributesTo(obs({ observedAt: "2026-01-01T00:00:00.001Z" }), g), true);
});

test("exactly at effective_to attributes (closed window is inclusive)", () => {
  const g = grant({ effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: "2026-01-01T01:00:00.000Z" });
  assert.equal(attributesTo(obs({ observedAt: "2026-01-01T01:00:00.000Z" }), g), true);
});

test("one millisecond after effective_to does not attribute", () => {
  const g = grant({ effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: "2026-01-01T01:00:00.000Z" });
  assert.equal(attributesTo(obs({ observedAt: "2026-01-01T01:00:00.001Z" }), g), false);
});

test("one millisecond before effective_to attributes", () => {
  const g = grant({ effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: "2026-01-01T01:00:00.000Z" });
  assert.equal(attributesTo(obs({ observedAt: "2026-01-01T00:59:59.999Z" }), g), true);
});

test("a still-open grant (effective_to null) attributes an observation far in the future", () => {
  const g = grant({ effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null });
  assert.equal(attributesTo(obs({ observedAt: "2030-01-01T00:00:00.000Z" }), g), true);
});

test("overlapping grants: one observation attributes to both", () => {
  const a = grant({ id: "a", effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: "2026-01-01T02:00:00.000Z" });
  const b = grant({ id: "b", effectiveFrom: "2026-01-01T01:00:00.000Z", effectiveTo: null });
  const observation = obs({ observedAt: "2026-01-01T01:30:00.000Z" });
  assert.equal(attributesTo(observation, a), true);
  assert.equal(attributesTo(observation, b), true);
});

test("capabilityContains: wildcard grant contains any observation capability", () => {
  assert.equal(capabilityContains("*", "service:web"), true);
  assert.equal(capabilityContains("*", "*"), true);
});

test("capabilityContains: exact match contains itself", () => {
  assert.equal(capabilityContains("service:web", "service:web"), true);
});

test("capabilityContains: a grant contains a more specific child scope", () => {
  assert.equal(capabilityContains("service:web", "service:web:port:8080"), true);
});

test("capabilityContains: a narrower grant does not contain a broader or sibling capability", () => {
  assert.equal(capabilityContains("provider:aws", "*"), false);
  assert.equal(capabilityContains("provider:aws", "provider:gcp"), false);
  // Not a child: "provider:aws-east" merely shares a string prefix with
  // "provider:aws" without the colon boundary - must not falsely match.
  assert.equal(capabilityContains("provider:aws", "provider:aws-east"), false);
});

test("attributesTo: capability scope gates attribution even within the time window", () => {
  const g = grant({ capability: "provider:aws" });
  assert.equal(attributesTo(obs({ capability: "service:web" }), g), false);
  assert.equal(attributesTo(obs({ capability: "provider:aws:credential" }), g), true);
});
