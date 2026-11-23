// Live tests against the real compiled service over its real TLS listener -
// no mock, no gateway, no sandbox required for these three. They exercise
// exactly what EvaluateHttpRequest does with real bytes on a real
// connection: payload-ceiling enforcement, redaction (grepping the
// service's own captured stdout for the sentinel value, per the prompt's
// own acceptance-criterion wording), and a policy-driven deny.
//
// This is NOT the credential-invisibility test (see
// credential-invisibility.test.ts) - that one specifically requires a real
// sandbox making a real outbound call through the gateway, which this file
// does not attempt.

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
  const dir = mkdtempSync(join(tmpdir(), "scout-middleware-live-test-"));
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

async function withService(
  port: number,
  run: (client: ReturnType<typeof createClient<typeof SupervisorMiddleware>>, service: ChildProcessWithoutNullStreams) => Promise<void>,
): Promise<string> {
  const fixture = buildTlsFixture();
  let stdout = "";
  const service = spawn(process.execPath, [SERVICE_ENTRY], {
    env: {
      ...process.env,
      SCOUT_INTERCEPTOR_SOCKET_PATH: join(fixture.dir, "interceptor.sock"),
      SCOUT_MIDDLEWARE_PORT: String(port),
      SCOUT_MIDDLEWARE_TLS_CERT_PATH: fixture.certPath,
      SCOUT_MIDDLEWARE_TLS_KEY_PATH: fixture.keyPath,
      SCOUT_HEALTH_PORT: String(port + 1000),
      SCOUT_POLICY_DATABASE_URL: TEST_POLICY_DATABASE_URL,
    },
  });
  service.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  service.stderr.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  try {
    await waitForListening(port, 10_000);
    const transport = createGrpcTransport({ baseUrl: `https://127.0.0.1:${port}`, nodeOptions: { rejectUnauthorized: false } });
    const client = createClient(SupervisorMiddleware, transport);
    await run(client, service);
  } finally {
    service.kill("SIGKILL");
    rmSync(fixture.dir, { recursive: true, force: true });
  }
  return stdout;
}

test("EvaluateHttpRequest denies a request exceeding the payload ceiling, live", async () => {
  const stdout = await withService(28500, async (client) => {
    const result = await client.evaluateHttpRequest({
      phase: 1, // PRE_CREDENTIALS
      context: { requestId: "r1", sandboxId: "s1", sandbox: "sb", workspace: "default" },
      target: { scheme: "https", host: "example.com", port: 443, method: "POST", path: "/upload", query: "" },
      headers: [],
      body: new Uint8Array(300_000),
      middlewareName: "scout-governance",
    });
    assert.equal(result.decision, 2 /* DECISION_DENY */);
    assert.match(result.reason, /exceeds the \d+-byte payload ceiling/);
  });
  assert.ok(stdout.length > 0);
});

test(
  "EvaluateHttpRequest redacts a matching header and the sentinel value never appears in the service's own output",
  async () => {
    const SENTINEL = "SCOUT-LIVE-TEST-SENTINEL-9f3a7c";
    const stdout = await withService(28510, async (client) => {
      const result = await client.evaluateHttpRequest({
        phase: 1,
        context: { requestId: "r2", sandboxId: "s1", sandbox: "sb", workspace: "default" },
        target: { scheme: "https", host: "example.com", port: 443, method: "GET", path: "/ok", query: "" },
        headers: [{ name: "x-trace-sentinel", value: SENTINEL }],
        body: new Uint8Array(0),
        middlewareName: "scout-governance",
      });
      assert.equal(result.decision, 1 /* DECISION_ALLOW */);
      assert.equal(result.headerMutations.length, 1);
      const mutation = result.headerMutations[0];
      assert.equal(mutation.operation.case, "write");
      if (mutation.operation.case === "write") {
        assert.equal(mutation.operation.value.name, "x-trace-sentinel");
        assert.notEqual(mutation.operation.value.value, SENTINEL);
      }
      assert.ok(
        !JSON.stringify(result).includes(SENTINEL),
        "the decision result sent back to the gateway must never carry the sentinel value",
      );
    });
    assert.ok(
      !stdout.includes(SENTINEL),
      `service's own stdout/stderr must never contain the sentinel value; captured output: ${stdout.length} bytes`,
    );
  },
);

test("EvaluateHttpRequest denies a policy-forbidden destination, live", async () => {
  await withService(28520, async (client) => {
    const result = await client.evaluateHttpRequest({
      phase: 1,
      context: { requestId: "r3", sandboxId: "s1", sandbox: "sb", workspace: "default" },
      target: { scheme: "https", host: "internal.example", port: 443, method: "GET", path: "/secrets", query: "" },
      headers: [],
      body: new Uint8Array(0),
      middlewareName: "scout-governance",
    });
    assert.equal(result.decision, 2 /* DECISION_DENY */);
    assert.match(result.reason, /egress to internal\.example is blocked/);
  });
});
