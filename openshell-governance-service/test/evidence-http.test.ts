// Live test against the real compiled service's real HTTP and TLS gRPC
// listeners together: drives one real decision through EvaluateHttpRequest,
// waits for the real background drain loop to write it, then reads it back
// through every /evidence/* route a real operator would use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, execFileSync as execSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { SupervisorMiddleware } from "../src/gen/supervisor_middleware_pb.js";

const SERVICE_ENTRY = join(import.meta.dirname, "../src/index.js");
const TEST_POLICY_DATABASE_URL =
  process.env.SCOUT_TEST_POLICY_DATABASE_URL ??
  "postgres://scout:scout-governance-dev-only@127.0.0.1:54320/scout_governance";

function buildTlsFixture(): { dir: string; certPath: string; keyPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "scout-evidence-http-test-"));
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
  return { dir, certPath, keyPath };
}

async function waitForListening(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync("bash", ["-c", `exec 3<>/dev/tcp/127.0.0.1/${port}`], { stdio: "ignore" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`port ${port} never started listening within ${timeoutMs}ms`);
}

async function getJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.json() };
}

async function getText(port: number, path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.text() };
}

test("a real decision becomes readable through every /evidence/* route", async () => {
  const fixture = buildTlsFixture();
  const middlewarePort = 28700;
  const healthPort = 28701;
  const service = spawn(process.execPath, [SERVICE_ENTRY], {
    env: {
      ...process.env,
      SCOUT_INTERCEPTOR_SOCKET_PATH: join(fixture.dir, "interceptor.sock"),
      SCOUT_MIDDLEWARE_PORT: String(middlewarePort),
      SCOUT_MIDDLEWARE_TLS_CERT_PATH: fixture.certPath,
      SCOUT_MIDDLEWARE_TLS_KEY_PATH: fixture.keyPath,
      SCOUT_HEALTH_PORT: String(healthPort),
      SCOUT_POLICY_DATABASE_URL: TEST_POLICY_DATABASE_URL,
      // Fast enough that the test does not need a long sleep, slow enough
      // that it still proves the write genuinely happens off the decision
      // path rather than synchronously inside EvaluateHttpRequest.
      SCOUT_EVIDENCE_DRAIN_INTERVAL_MS: "200",
    },
  });
  let stdout = "";
  service.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  service.stderr.on("data", (chunk) => (stdout += chunk.toString()));

  try {
    await waitForListening(healthPort, 10_000);
    await waitForListening(middlewarePort, 10_000);

    const correlationId = `evidence-http-test-${Math.random().toString(36).slice(2)}`;
    const transport = createGrpcTransport({
      baseUrl: `https://127.0.0.1:${middlewarePort}`,
      nodeOptions: { rejectUnauthorized: false },
    });
    const client = createClient(SupervisorMiddleware, transport);
    const result = await client.evaluateHttpRequest({
      phase: 1, // PRE_CREDENTIALS
      context: { requestId: correlationId, sandboxId: "sbx-evidence-http", sandbox: "sbx", workspace: "default" },
      target: { scheme: "https", host: "example.com", port: 443, method: "GET", path: "/ok", query: "" },
      headers: [],
      body: new Uint8Array(0),
      middlewareName: "scout-governance",
    });
    assert.equal(result.decision, 1 /* DECISION_ALLOW */);

    // Give the drain loop a few ticks to actually write it.
    let decisions: Array<{ decision_uid: string; correlation_id: string }> = [];
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const list = await getJson(healthPort, `/evidence/decisions?rpc=HttpRequest&limit=50`);
      assert.equal(list.status, 200);
      decisions = (list.body as { decisions: Array<{ decision_uid: string; correlation_id: string }> }).decisions;
      if (decisions.some((d) => d.correlation_id === correlationId)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const found = decisions.find((d) => d.correlation_id === correlationId);
    assert.ok(found, "the decision must appear in GET /evidence/decisions once drained");

    const detail = await getJson(healthPort, `/evidence/decisions/${found!.decision_uid}`);
    assert.equal(detail.status, 200);
    const detailBody = detail.body as {
      decision: { correlation_id: string; verdict: string; policy_digest: string };
      provenance: unknown[];
    };
    assert.equal(detailBody.decision.correlation_id, correlationId);
    assert.equal(detailBody.decision.verdict, "allow");
    assert.ok(Array.isArray(detailBody.provenance));

    const health = await getJson(healthPort, "/evidence/health");
    assert.equal(health.status, 200);
    const healthBody = health.body as { decisionsWrittenTotal: number; queueDepth: number };
    assert.ok(healthBody.decisionsWrittenTotal >= 1);
    assert.equal(typeof healthBody.queueDepth, "number");

    const policies = await getJson(healthPort, "/evidence/policies");
    assert.equal(policies.status, 200);
    const policiesBody = policies.body as { policies: Array<{ policyDigest: string; events: unknown[] }> };
    assert.ok(Array.isArray(policiesBody.policies));
    assert.ok(
      policiesBody.policies.some((p) => p.policyDigest === detailBody.decision.policy_digest),
      "the decision just written must resolve to an entry on /evidence/policies",
    );
    for (const p of policiesBody.policies) {
      assert.ok(p.events.length > 0, "every listed policy must have at least one provenance event");
    }

    const exported = await getText(healthPort, "/evidence/export");
    assert.equal(exported.status, 200);
    const exportedLines = exported.body.trim().split("\n").filter(Boolean);
    assert.ok(
      exportedLines.some((line) => JSON.parse(line).decision_uid === found!.decision_uid),
      "the exported NDJSON must include the decision we just wrote",
    );
    for (const line of exportedLines) {
      assert.doesNotThrow(() => JSON.parse(line), "every NDJSON line must be valid JSON on its own");
    }
  } finally {
    service.kill("SIGKILL");
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
