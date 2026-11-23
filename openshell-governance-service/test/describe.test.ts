// Unit tests for the Describe manifests. Pure functions, no process
// spawning - the registration proofs that need a real gateway live in
// registration.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInterceptorManifest, GRANT_LIFECYCLE_RPCS } from "../src/protocol/describe-interceptor.js";
import { buildMiddlewareManifest } from "../src/protocol/describe-middleware.js";
import { loadConfig } from "../src/config.js";

function testConfig() {
  process.env.SCOUT_MIDDLEWARE_TLS_CERT_PATH ??= "/tmp/unused-cert.pem";
  process.env.SCOUT_MIDDLEWARE_TLS_KEY_PATH ??= "/tmp/unused-key.pem";
  // loadConfig() requires this to be set, but these tests never connect to
  // Postgres - they only build manifests, which do not touch policy state.
  process.env.SCOUT_POLICY_DATABASE_URL ??= "postgres://unused/unused";
  return loadConfig();
}

test("interceptor manifest declares protocol 1.0 and the exact gateway-interceptor capability", () => {
  const manifest = buildInterceptorManifest(testConfig());
  assert.equal(manifest.extension?.protocolVersion?.major, 1);
  assert.equal(manifest.extension?.protocolVersion?.minor, 0);
  assert.deepEqual(manifest.extension?.supportedCapabilities, [
    "openshell.gateway-interceptor.contract",
  ]);
  assert.deepEqual(manifest.extension?.requiredCapabilities, [
    "openshell.gateway-interceptor.contract",
  ]);
});

test("interceptor manifest expected_audience matches the configured audience exactly", () => {
  const config = testConfig();
  const manifest = buildInterceptorManifest(config);
  assert.equal(manifest.expectedAudience, config.interceptorAudience);
});

test("interceptor manifest is fail_closed by default, and post_commit is confined to GRANT_LIFECYCLE_RPCS", () => {
  // Superseded by prompt 06: post_commit is now bound, but only for the
  // four RPCs consequence linkage needs (see GRANT_LIFECYCLE_RPCS and its
  // comment in describe-interceptor.ts for why - a real gateway run
  // refused a manifest declaring two bindings for one RPC, so post_commit
  // had to join the existing binding, forcing that whole binding to
  // fail_open per the proto's own rule). Every other binding must still be
  // fail_closed with no post_commit, exactly as prompt 03 proved.
  const manifest = buildInterceptorManifest(testConfig());
  assert.equal(manifest.failurePolicy, "fail_closed");
  // GatewayInterceptorPhase.POST_COMMIT === 4
  const grantLifecycleRpcs = new Set(GRANT_LIFECYCLE_RPCS.map((method) => `openshell.v1.OpenShell/${method}`));
  for (const binding of manifest.bindings) {
    const rpc = binding.selector?.rpc;
    if (rpc && grantLifecycleRpcs.has(rpc)) {
      assert.equal(binding.failurePolicy, "fail_open");
      assert.ok(binding.phases.includes(4), `${binding.id} must bind post_commit`);
    } else {
      assert.equal(binding.failurePolicy, "fail_closed");
      assert.ok(!binding.phases.includes(4), `${binding.id} must not bind post_commit`);
    }
  }
});

test("middleware manifest declares protocol 1.0 and the exact supervisor-middleware capability", () => {
  const manifest = buildMiddlewareManifest(testConfig());
  assert.equal(manifest.extension?.protocolVersion?.major, 1);
  assert.equal(manifest.extension?.protocolVersion?.minor, 0);
  assert.deepEqual(manifest.extension?.supportedCapabilities, [
    "openshell.supervisor-middleware.contract",
  ]);
});

test("middleware manifest expected_audience matches the configured audience exactly", () => {
  const config = testConfig();
  const manifest = buildMiddlewareManifest(config);
  assert.equal(manifest.expectedAudience, config.middlewareAudience);
});

test("middleware manifest declares HTTP_REQUEST/PRE_CREDENTIALS and HTTP_RESPONSE/PRE_RETURN only", () => {
  const manifest = buildMiddlewareManifest(testConfig());
  const pairs = manifest.bindings.map((b) => [b.operation, b.phase]);
  // HTTP_REQUEST=1/PRE_CREDENTIALS=1, HTTP_RESPONSE=3/PRE_RETURN=2
  assert.deepEqual(pairs, [
    [1, 1],
    [3, 2],
  ]);
});

test("debugProtocolMajorOverride overrides the reported protocol major (test-only escape hatch)", () => {
  const config = testConfig();
  config.debugProtocolMajorOverride = 2;
  const manifest = buildInterceptorManifest(config);
  assert.equal(manifest.extension?.protocolVersion?.major, 2);
});
