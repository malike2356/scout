// Entrypoint. Starts three listeners:
//   - GatewayInterceptor over a plaintext h2c Unix socket (unix:// transport
//     needs no TLS; the gateway authenticates via a minted bearer token
//     instead, per openshell-extension-core's transport.rs).
//   - SupervisorMiddleware + HttpResponsePreReturn over TLS (middleware only
//     accepts https://, since sandbox supervisors - not only the gateway -
//     must reach it).
//   - An operator HTTP surface (health, policy status/reload).
//
// The policy snapshot is loaded once, fully, before any of these listeners
// start - Describe and Evaluate must never answer against a half-initialized
// policy state.

import { createServer as createHttp2Server, createSecureServer } from "node:http2";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import pg from "pg";
import { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { loadConfig, type ServiceConfig } from "./config.js";
import { GatewayInterceptor } from "./gen/gateway_interceptor_pb.js";
import { SupervisorMiddleware, HttpResponsePreReturn } from "./gen/supervisor_middleware_pb.js";
import { buildInterceptorService } from "./protocol/describe-interceptor.js";
import { buildMiddlewareService } from "./protocol/describe-middleware.js";
import { buildHttpResponsePreReturnService } from "./protocol/evaluate.js";
import { startHealthServer } from "./health.js";
import { log } from "./log.js";
import { createInstrumentedPool } from "./policy/db.js";
import { PolicySnapshotManager } from "./policy/snapshot.js";
import { EvidenceWriter } from "./evidence/writer.js";
import { LinkageWriter } from "./linkage/writer.js";

function startInterceptorServer(
  config: ServiceConfig,
  policy: PolicySnapshotManager,
  evidence: EvidenceWriter,
  linkage: LinkageWriter,
): void {
  if (existsSync(config.interceptorSocketPath)) {
    unlinkSync(config.interceptorSocketPath);
  }

  const handler = connectNodeAdapter({
    routes: (r) => r.service(GatewayInterceptor, buildInterceptorService(config, policy, evidence, linkage)),
  });
  const server = createHttp2Server(handler);
  server.listen(config.interceptorSocketPath, () => {
    log("interceptor_listening");
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    // error.code only (e.g. EADDRINUSE, EACCES) - error.message can embed
    // the socket path, which is an absolute workstation path and must not
    // be logged.
    log("interceptor_server_error", { code: error.code ?? "unknown" });
  });
}

function startMiddlewareServer(
  config: ServiceConfig,
  policy: PolicySnapshotManager,
  evidence: EvidenceWriter,
  linkage: LinkageWriter,
): void {
  const key = readFileSync(config.middlewareTlsKeyPath);
  const cert = readFileSync(config.middlewareTlsCertPath);

  const handler = connectNodeAdapter({
    routes: (r: ConnectRouter) => {
      r.service(SupervisorMiddleware, buildMiddlewareService(config, policy, evidence, linkage));
      r.service(HttpResponsePreReturn, buildHttpResponsePreReturnService(policy, evidence));
    },
  });

  const server = createSecureServer({ key, cert, allowHTTP1: false }, handler);
  server.listen(config.middlewarePort, () => {
    log("middleware_listening", { port: config.middlewarePort });
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    log("middleware_server_error", { code: error.code ?? "unknown" });
  });
}

function onDigestsSuperseded(evidence: EvidenceWriter, linkage: LinkageWriter, supersededDigests: string[]): void {
  const occurredAt = new Date().toISOString();
  for (const digest of supersededDigests) {
    linkage.closeGrantsForSupersededDigest(digest, occurredAt);
    void evidence.recordSupersession(digest);
  }
}

function wireReload(
  config: ServiceConfig,
  policy: PolicySnapshotManager,
  evidence: EvidenceWriter,
  linkage: LinkageWriter,
): void {
  const timer = setInterval(() => {
    void policy.reload().then((result) => {
      if (result.ok) {
        log("policy_reload_ok", { policy_count: result.digestCount });
        onDigestsSuperseded(evidence, linkage, result.supersededDigests);
      } else {
        // A failed reload keeps the previous snapshot - this log line is the
        // alert; /policy/status carries the same failure for an operator
        // who did not catch the log.
        log("policy_reload_failed", { error: result.error });
      }
    });
  }, config.policyReloadIntervalMs);
  timer.unref();

  process.on("SIGHUP", () => {
    log("policy_reload_triggered", { source: "SIGHUP" });
    void policy.reload().then((result) => {
      log(result.ok ? "policy_reload_ok" : "policy_reload_failed", result.ok ? { policy_count: result.digestCount } : { error: result.error });
      if (result.ok) onDigestsSuperseded(evidence, linkage, result.supersededDigests);
    });
  });
}

function wireDrainLoops(config: ServiceConfig, evidence: EvidenceWriter, linkage: LinkageWriter): void {
  const timer = setInterval(() => {
    void evidence.drainOnce().catch((error: unknown) => {
      // drainOnce() already routes individual row failures to the
      // dead-letter table; reaching here means something broke outside
      // that path entirely (e.g. the pool itself is down) - log it, but
      // there is nothing more to do than retry on the next tick.
      log("evidence_drain_tick_failed", {
        error: error instanceof Error ? error.message : "unknown error",
      });
    });
    void linkage.drainOnce().catch((error: unknown) => {
      log("linkage_drain_tick_failed", {
        error: error instanceof Error ? error.message : "unknown error",
      });
    });
  }, config.evidenceDrainIntervalMs);
  timer.unref();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createInstrumentedPool(config.policyDatabaseUrl);
  // A separate, uninstrumented pool: the evidence writer's own background
  // queries must never count against decide.ts's "zero database round
  // trips during Evaluate" instrumented-pool test.
  const evidencePool = new pg.Pool({ connectionString: config.policyDatabaseUrl });
  const evidence = new EvidenceWriter(evidencePool, { serviceVersion: config.implementationVersion, queueCapacity: config.evidenceQueueCapacity });
  // Shares evidencePool rather than opening a fourth connection pool - both
  // writers only ever touch Postgres from their own drainOnce(), never from
  // a decision path, so there is nothing for them to contend over.
  const linkage = new LinkageWriter(evidencePool, { queueCapacity: config.linkageQueueCapacity });

  // Must complete before Describe/Evaluate are reachable - there is no
  // previous snapshot to fall back to on the very first load.
  const policy = await PolicySnapshotManager.bootstrap(pool);
  log("policy_bootstrapped", { policy_count: policy.snapshot().policiesById.size });

  startInterceptorServer(config, policy, evidence, linkage);
  startMiddlewareServer(config, policy, evidence, linkage);
  startHealthServer(config.healthPort, policy, config.middlewareMaxPayloadBytes, evidence, linkage);
  wireReload(config, policy, evidence, linkage);
  wireDrainLoops(config, evidence, linkage);

  log("started", {
    implementation: config.implementationName,
    version: config.implementationVersion,
  });
}

main().catch((error: unknown) => {
  log("startup_failed", { error: error instanceof Error ? error.message : "unknown error" });
  process.exitCode = 1;
});
