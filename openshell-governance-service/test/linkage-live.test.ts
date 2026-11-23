// Live, end-to-end test against the real compiled service: no mock, no real
// gateway either (that is registration.test.ts's job) - instead this test
// is the GatewayInterceptor's one real client, connecting directly over the
// same plaintext h2c unix socket the gateway itself would use (per
// openshell-extension-core's transport.rs, interceptors need no TLS). That
// lets it drive real post_commit CreateSandbox/ExposeService/DeleteSandbox
// evaluations - exactly what prompt 06's grant lifecycle depends on -
// without needing a live sandbox driver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { connect as netConnect } from "node:net";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { GatewayInterceptor } from "../src/gen/gateway_interceptor_pb.js";
import { SupervisorMiddleware } from "../src/gen/supervisor_middleware_pb.js";

const SERVICE_ENTRY = join(import.meta.dirname, "../src/index.js");
const TEST_POLICY_DATABASE_URL =
  process.env.SCOUT_TEST_POLICY_DATABASE_URL ??
  "postgres://scout:scout-governance-dev-only@127.0.0.1:54320/scout_governance";

function buildTlsFixture(dir: string): { certPath: string; keyPath: string } {
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  const cnf = join(dir, "cert.cnf");
  writeFileSync(
    cnf,
    "[req]\ndistinguished_name=req_distinguished_name\nx509_extensions=v3_req\nprompt=no\n" +
      "[req_distinguished_name]\nCN=scout-test\n[v3_req]\nsubjectAltName=@alt\n[alt]\nIP.1=127.0.0.1\nDNS.1=localhost\n",
  );
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-config", cnf,
  ]);
  return { certPath, keyPath };
}

async function waitForListening(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execFileSync("bash", ["-c", `exec 3<>/dev/tcp/127.0.0.1/${port}`], { stdio: "ignore" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`port ${port} never started listening within ${timeoutMs}ms`);
}

async function waitForSocket(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = netConnect(path);
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`unix socket ${path} never became connectable within ${timeoutMs}ms`);
}

async function getJson(port: number, path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.json() };
}

async function postJson(port: number, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function pollUntil<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("condition never became true within timeout");
}

test("the grant lifecycle and both linkage queries work end to end against the real service", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scout-linkage-live-test-"));
  const { certPath, keyPath } = buildTlsFixture(dir);
  const socketPath = join(dir, "interceptor.sock");
  const middlewarePort = 28800;
  const healthPort = 28801;

  const service = spawn(process.execPath, [SERVICE_ENTRY], {
    env: {
      ...process.env,
      SCOUT_INTERCEPTOR_SOCKET_PATH: socketPath,
      SCOUT_MIDDLEWARE_PORT: String(middlewarePort),
      SCOUT_MIDDLEWARE_TLS_CERT_PATH: certPath,
      SCOUT_MIDDLEWARE_TLS_KEY_PATH: keyPath,
      SCOUT_HEALTH_PORT: String(healthPort),
      SCOUT_POLICY_DATABASE_URL: TEST_POLICY_DATABASE_URL,
      SCOUT_EVIDENCE_DRAIN_INTERVAL_MS: "200",
    },
  });
  let stdout = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stdout += chunk.toString()));

  try {
    await waitForListening(healthPort, 10_000);
    await waitForListening(middlewarePort, 10_000);
    await waitForSocket(socketPath, 10_000);

    const interceptorTransport = createGrpcTransport({
      baseUrl: "http://scout-governance-interceptor",
      nodeOptions: { createConnection: () => netConnect(socketPath) },
    });
    const interceptor = createClient(GatewayInterceptor, interceptorTransport);

    const sandboxId = `sbx-linkage-${Math.random().toString(36).slice(2)}`;
    const createResult = await interceptor.evaluate({
      interceptorName: "scout-governance",
      bindingId: "test-createsandbox-post-commit",
      service: "openshell.v1.OpenShell",
      method: "CreateSandbox",
      principal: {},
      phase: { case: "postCommit", value: { committedResponse: { sandbox: { metadata: { id: sandboxId } } } } },
    });
    assert.equal(createResult.allowed, true, "post_commit always allows by construction");

    // Find the decision_uid the grant was opened under, via the evidence
    // store this decision also wrote to.
    const decisionsList = await pollUntil(
      () => getJson(healthPort, "/evidence/decisions?rpc=CreateSandbox&limit=20"),
      (r) => r.body.decisions.some((d: any) => d.sandbox_id === sandboxId),
      10_000,
    );
    const decisionUid = decisionsList.body.decisions.find((d: any) => d.sandbox_id === sandboxId).decision_uid;

    const activity = await pollUntil(
      () => getJson(healthPort, `/linkage/decisions/${decisionUid}/activity`),
      (r) => r.body.grants.length > 0,
      10_000,
    );
    assert.equal(activity.body.grants.length, 1);
    assert.equal(activity.body.grants[0].sandbox_id, sandboxId);
    assert.equal(activity.body.grants[0].capability, "*");
    assert.equal(activity.body.grants[0].effective_to, null);
    const grantId = activity.body.grants[0].id;

    // Drive one real outbound data-plane decision for this sandbox so it
    // becomes an observation attributed to the grant above.
    const middlewareTransport = createGrpcTransport({
      baseUrl: `https://127.0.0.1:${middlewarePort}`,
      nodeOptions: { rejectUnauthorized: false },
    });
    const middleware = createClient(SupervisorMiddleware, middlewareTransport);
    await middleware.evaluateHttpRequest({
      phase: 1, // PRE_CREDENTIALS
      context: { requestId: "linkage-live-req", sandboxId, sandbox: "sbx", workspace: "default" },
      target: { scheme: "https", host: "example.com", port: 443, method: "GET", path: "/ok", query: "" },
      headers: [],
      body: new Uint8Array(0),
      middlewareName: "scout-governance",
    });

    const activityWithObservation = await pollUntil(
      () => getJson(healthPort, `/linkage/decisions/${decisionUid}/activity`),
      (r) => r.body.observations.length > 0,
      10_000,
    );
    assert.equal(activityWithObservation.body.observations.length, 1);
    assert.equal(activityWithObservation.body.observations[0].destination_host, "example.com");
    assert.equal(activityWithObservation.body.observations[0].outcome, "succeeded");

    // GET /linkage/grants/:id must agree with the forward query.
    const grantDetail = await getJson(healthPort, `/linkage/grants/${grantId}`);
    assert.equal(grantDetail.status, 200);
    assert.equal(grantDetail.body.grant.sandbox_id, sandboxId);
    assert.equal(grantDetail.body.observations.length, 1);

    // The inverse query must agree with the forward query: the same
    // decision_uid must come back as a permitting decision for this host
    // and window.
    const inverse = await postJson(healthPort, "/linkage/inverse", {
      host: "example.com",
      from: "2020-01-01T00:00:00.000Z",
      to: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(inverse.status, 200);
    assert.ok(
      inverse.body.permittingDecisions.includes(decisionUid),
      "the inverse query must agree with the forward query on which decision permitted this host",
    );

    // GET /linkage/grants (list) must include this grant when filtered to
    // open grants for its sandbox.
    const grantsList = await getJson(healthPort, `/linkage/grants?open=true&sandboxId=${sandboxId}`);
    assert.equal(grantsList.status, 200);
    assert.ok(grantsList.body.grants.some((g: any) => g.id === grantId));

    // Revoke (prompt 08's emergency lever) on a SEPARATE grant, so it does
    // not disturb the DeleteSandbox-closes-it assertion below for the
    // first grant. Must never report success for a grant that was not
    // actually, definitely closed.
    const secondSandboxId = `sbx-linkage-revoke-${Math.random().toString(36).slice(2)}`;
    await interceptor.evaluate({
      interceptorName: "scout-governance",
      bindingId: "test-createsandbox-post-commit-2",
      service: "openshell.v1.OpenShell",
      method: "CreateSandbox",
      principal: {},
      phase: { case: "postCommit", value: { committedResponse: { sandbox: { metadata: { id: secondSandboxId } } } } },
    });
    const secondGrant = await pollUntil(
      () => getJson(healthPort, `/linkage/grants?sandboxId=${secondSandboxId}`),
      (r) => r.body.grants.length > 0,
      10_000,
    );
    const secondGrantId = secondGrant.body.grants[0].id;

    const revoked = await (async (): Promise<{ status: number; body: any }> => {
      const response = await fetch(`http://127.0.0.1:${healthPort}/linkage/grants/${secondGrantId}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: "test-operator", note: "revoked by linkage-live.test.ts" }),
      });
      return { status: response.status, body: await response.json() };
    })();
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.ok, true);
    assert.equal(revoked.body.grant.closedReason, "revoked");
    assert.equal(revoked.body.liveCapabilityDetachAttempted, false);

    // Revoking the same grant again must fail honestly, not report a
    // phantom second success.
    const revokedAgain = await (async (): Promise<{ status: number; body: any }> => {
      const response = await fetch(`http://127.0.0.1:${healthPort}/linkage/grants/${secondGrantId}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: "test-operator", note: "second attempt" }),
      });
      return { status: response.status, body: await response.json() };
    })();
    assert.equal(revokedAgain.status, 409);
    assert.equal(revokedAgain.body.ok, false);

    // A post_commit ExposeService whose response has no resolvable sandbox
    // id must show up in /linkage/gaps as a decision with no grant, never
    // silently open a wrongly-keyed one.
    await interceptor.evaluate({
      interceptorName: "scout-governance",
      bindingId: "test-exposeservice-post-commit",
      service: "openshell.v1.OpenShell",
      method: "ExposeService",
      principal: {},
      phase: { case: "postCommit", value: { committedResponse: { endpoint: { name: "web" } } } }, // no sandboxId
    });
    const gaps = await pollUntil(
      () => getJson(healthPort, "/linkage/gaps"),
      (r) => r.body.decisionsWithoutGrants.some((d: any) => d.rpc === "ExposeService"),
      10_000,
    );
    assert.ok(gaps.body.decisionsWithoutGrants.some((d: any) => d.rpc === "ExposeService"));

    // DeleteSandbox's post_commit must close the grant we opened above.
    await interceptor.evaluate({
      interceptorName: "scout-governance",
      bindingId: "test-deletesandbox-post-commit",
      service: "openshell.v1.OpenShell",
      method: "DeleteSandbox",
      principal: {},
      phase: { case: "postCommit", value: { committedResponse: { sandboxId } } },
    });
    const closedGrant = await pollUntil(
      () => getJson(healthPort, `/linkage/grants/${grantId}`),
      (r) => r.body.grant.effective_to !== null,
      10_000,
    );
    assert.equal(closedGrant.body.grant.closed_reason, "sandbox_ended");
  } finally {
    service.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
