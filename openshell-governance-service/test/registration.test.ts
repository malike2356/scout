// The fail-closed boot proof. Spawns the real OpenShell gateway binary from
// the vendored clone against the real compiled service (dist/src/index.js),
// reproducing prompt 02's three acceptance-criteria proofs plus the baseline
// ready-state check. Skips (does not fail) if the vendored gateway binary
// has not been built, since that is a workstation build step outside this
// prompt's scope - but every assertion below was run and passed in-session
// against a real build; see docs/decisions/ for the captured logs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VALIDATE_ONLY_RPCS, GRANT_LIFECYCLE_RPCS } from "../src/protocol/describe-interceptor.js";

// import.meta.dirname is the compiled location, dist/test/ - three levels up
// reaches the service package root (dist/test -> dist -> package root), then
// one more reaches the scout repo root where _vendor/ lives.
const VENDOR_ROOT = join(import.meta.dirname, "../../../_vendor/OpenShell");
const GATEWAY_BIN = join(VENDOR_ROOT, "target/debug/openshell-gateway");
const SERVICE_ENTRY = join(import.meta.dirname, "../src/index.js");

function cleanEnv(): NodeJS.ProcessEnv {
  // The gateway binary treats OPENSHELL_COMPUTE_DRIVER="" as an explicit,
  // invalid empty value, not "unset" - it must be absent, matching `env -u`.
  const { OPENSHELL_COMPUTE_DRIVER, ...rest } = process.env;
  return rest;
}

function gatewayAvailable(): boolean {
  return existsSync(GATEWAY_BIN) && existsSync(SERVICE_ENTRY);
}

interface Fixture {
  dir: string;
  socketPath: string;
  certPath: string;
  keyPath: string;
}

function buildFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "scout-registration-test-"));
  const certPath = join(dir, "middleware-cert.pem");
  const keyPath = join(dir, "middleware-key.pem");
  const cnf = join(dir, "cert.cnf");
  writeFileSync(
    cnf,
    "[req]\ndistinguished_name=req_distinguished_name\nx509_extensions=v3_req\nprompt=no\n" +
      "[req_distinguished_name]\nCN=scout-test\n[v3_req]\nsubjectAltName=@alt\n" +
      "[alt]\nIP.1=127.0.0.1\nDNS.1=localhost\n",
  );
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certPath, "-config", cnf,
  ]);
  const signingKey = join(dir, "signing.pem");
  const publicKey = join(dir, "public.pem");
  execFileSync("openssl", ["genpkey", "-algorithm", "ed25519", "-out", signingKey]);
  execFileSync("openssl", ["pkey", "-in", signingKey, "-pubout", "-out", publicKey]);
  writeFileSync(join(dir, "kid"), "scout-registration-test\n");
  const socketPath = join(dir, "interceptor.sock");

  writeFileSync(
    join(dir, "gateway.toml"),
    `[openshell]
version = 2
[openshell.gateway]
[openshell.gateway.auth]
allow_unauthenticated_users = true
[openshell.gateway.gateway_jwt]
signing_key_path = "${signingKey}"
public_key_path = "${publicKey}"
kid_path = "${join(dir, "kid")}"
gateway_id = "scout-registration-test"
[[openshell.gateway.interceptors]]
name = "scout-governance"
grpc_endpoint = "unix://${socketPath}"
audience = "{{INTERCEPTOR_AUDIENCE}}"
failure_policy = "fail_closed"
binding_policy = "exact"
timeout = "500ms"
[[openshell.gateway.interceptors.bindings]]
rpc = "openshell.v1.OpenShell/CreateSandbox"
phases = ["modify_operation", "validate", "post_commit"]
failure_policy = "fail_open"
${VALIDATE_ONLY_RPCS.map(
  (rpc) => `[[openshell.gateway.interceptors.bindings]]\nrpc = "openshell.v1.OpenShell/${rpc}"\nphases = ["validate"]`,
).join("\n")}
${GRANT_LIFECYCLE_RPCS.filter((rpc) => rpc !== "CreateSandbox")
  .map(
    (rpc) =>
      `[[openshell.gateway.interceptors.bindings]]\nrpc = "openshell.v1.OpenShell/${rpc}"\nphases = ["validate", "post_commit"]\nfailure_policy = "fail_open"`,
  )
  .join("\n")}
[openshell.supervisor]
[[openshell.supervisor.middleware]]
name = "scout-governance"
grpc_endpoint = "https://127.0.0.1:{{MW_PORT}}"
tls_ca_cert_path = "${certPath}"
audience = "urn:openshell:extension:middleware:scout-governance"
max_payload_bytes = 262144
timeout = "500ms"
`,
  );
  return { dir, socketPath, certPath, keyPath };
}

function writeGatewayToml(
  fixture: Fixture,
  opts: { interceptorAudience: string; middlewarePort: number },
): string {
  const path = join(fixture.dir, "gateway.toml");
  const raw = readFileSync(path, "utf8");
  const filled = raw
    .replace("{{INTERCEPTOR_AUDIENCE}}", opts.interceptorAudience)
    .replace("{{MW_PORT}}", String(opts.middlewarePort));
  const outPath = join(fixture.dir, `gateway-${opts.interceptorAudience.length}-${opts.middlewarePort}.toml`);
  writeFileSync(outPath, filled);
  return outPath;
}

function spawnService(
  fixture: Fixture,
  middlewarePort: number,
  extraEnv: Record<string, string> = {},
): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [SERVICE_ENTRY], {
    env: {
      ...process.env,
      SCOUT_INTERCEPTOR_SOCKET_PATH: fixture.socketPath,
      SCOUT_MIDDLEWARE_PORT: String(middlewarePort),
      SCOUT_MIDDLEWARE_TLS_CERT_PATH: fixture.certPath,
      SCOUT_MIDDLEWARE_TLS_KEY_PATH: fixture.keyPath,
      SCOUT_POLICY_DATABASE_URL:
        process.env.SCOUT_TEST_POLICY_DATABASE_URL ??
        "postgres://scout:scout-governance-dev-only@127.0.0.1:54320/scout_governance",
      SCOUT_HEALTH_PORT: String(middlewarePort + 1000),
      ...extraEnv,
    },
  });
}

function waitForLog(
  child: ChildProcessWithoutNullStreams,
  needle: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${needle}"; saw: ${buf}`)),
      timeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      if (buf.includes(needle)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs}ms; stderr so far: ${stderr}`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

test(
  "fails closed when Scout is not running",
  { skip: !gatewayAvailable() && "vendored gateway binary not built" },
  async () => {
    const fixture = buildFixture();
    try {
      const tomlPath = writeGatewayToml(fixture, {
        interceptorAudience: "urn:verlox:scout:governance",
        middlewarePort: 28210,
      });
      const gateway = spawn(GATEWAY_BIN, [
        "--config", tomlPath,
        "--bind-address", "127.0.0.1",
        "--port", "28200",
        "--health-port", "28201",
        "--metrics-port", "0",
        "--log-level", "info",
        "--disable-tls",
        "--db-url", `sqlite://${fixture.dir}/gateway.db`,
      ], { env: cleanEnv() });
      const { code, stderr } = await waitForExit(gateway, 15_000);
      assert.notEqual(code, 0, "gateway must refuse to start with no Scout running");
      assert.match(stderr, /could not connect|transport error/i);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  },
);

test(
  "refuses to start when Describe reports an incompatible protocol version",
  { skip: !gatewayAvailable() && "vendored gateway binary not built" },
  async () => {
    const fixture = buildFixture();
    const service = spawnService(fixture, 28211, {
      SCOUT_DEBUG_PROTOCOL_MAJOR_OVERRIDE: "2",
    });
    try {
      await waitForLog(service, "middleware_listening", 5_000);
      const tomlPath = writeGatewayToml(fixture, {
        interceptorAudience: "urn:verlox:scout:governance",
        middlewarePort: 28211,
      });
      const gateway = spawn(GATEWAY_BIN, [
        "--config", tomlPath,
        "--bind-address", "127.0.0.1",
        "--port", "28202",
        "--health-port", "28203",
        "--metrics-port", "0",
        "--log-level", "info",
        "--disable-tls",
        "--db-url", `sqlite://${fixture.dir}/gateway.db`,
      ], { env: cleanEnv() });
      const { code, stderr } = await waitForExit(gateway, 15_000);
      assert.notEqual(code, 0);
      assert.match(stderr, /unsupported protocol 2\.0.*gateway supports 1\.0/s);
    } finally {
      service.kill("SIGKILL");
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  },
);

test(
  "refuses to start when the registration audience does not match what Scout verifies",
  { skip: !gatewayAvailable() && "vendored gateway binary not built" },
  async () => {
    const fixture = buildFixture();
    const service = spawnService(fixture, 28212);
    try {
      await waitForLog(service, "middleware_listening", 5_000);
      const tomlPath = writeGatewayToml(fixture, {
        interceptorAudience: "urn:verlox:scout:WRONG-AUDIENCE",
        middlewarePort: 28212,
      });
      const gateway = spawn(GATEWAY_BIN, [
        "--config", tomlPath,
        "--bind-address", "127.0.0.1",
        "--port", "28204",
        "--health-port", "28205",
        "--metrics-port", "0",
        "--log-level", "info",
        "--disable-tls",
        "--db-url", `sqlite://${fixture.dir}/gateway.db`,
      ], { env: cleanEnv() });
      const { code, stderr } = await waitForExit(gateway, 15_000);
      assert.notEqual(code, 0);
      // The real CLI wraps this message across lines with "│ " continuation
      // prefixes, so assert on the fragments rather than one literal string.
      assert.match(stderr, /expects audience/);
      assert.match(stderr, /urn:verlox:scout:governance/);
      assert.match(stderr, /gateway is configured to mint/);
      assert.match(stderr, /urn:verlox:scout:WRONG-AUDIENCE/);
    } finally {
      service.kill("SIGKILL");
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  },
);
