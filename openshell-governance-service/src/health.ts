// Operator HTTP surface. Not a substitute for Describe: the gateway builds
// its execution plan once at startup and does not poll this. This exists so
// a human (or break-glass tooling) can see Scout is up and inspect/force a
// policy reload, because in this architecture Scout being down means the
// platform is down.
//
//   GET  /health            - liveness, 200 when up
//   GET  /policy/status     - active snapshot digests, load time, reload failures
//   POST /policy/reload     - force a reload; returns the new digest or the failure
//   GET  /middleware/status - payload ceiling, decisions served, denials, redactions
//   GET  /evidence/*        - the evidence store's read surface (prompt 05, see evidence/http.ts)

import { createServer, type Server } from "node:http";
import type { EvidenceWriter } from "./evidence/writer.js";
import { handleEvidenceRequest } from "./evidence/http.js";
import type { LinkageWriter } from "./linkage/writer.js";
import { handleLinkageRequest } from "./linkage/http.js";
import type { PolicySnapshotManager } from "./policy/snapshot.js";
import { getMiddlewareStats } from "./middleware/stats.js";

function writeJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function startHealthServer(
  port: number,
  policy: PolicySnapshotManager,
  middlewareMaxPayloadBytes: number,
  evidence: EvidenceWriter,
  linkage: LinkageWriter,
): Server {
  const server = createServer((req, res) => {
    if (handleEvidenceRequest(req, res, evidence)) {
      return;
    }
    if (handleLinkageRequest(req, res, linkage)) {
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.method === "GET" && req.url === "/policy/status") {
      const snapshot = policy.snapshot();
      const diagnostics = policy.getDiagnostics();
      writeJson(res, 200, {
        loadedAt: snapshot.loadedAt,
        policyCount: snapshot.policiesById.size,
        bindingCount: snapshot.bindings.length,
        digests: [...snapshot.policiesById.values()].map((p) => ({
          policySlug: p.policySlug,
          version: p.version,
          digestSha256: p.digestSha256,
        })),
        lastReloadAttemptAt: diagnostics.lastReloadAttemptAt,
        lastSuccessfulReloadAt: diagnostics.lastSuccessfulReloadAt,
        lastReloadError: diagnostics.lastReloadError,
      });
      return;
    }

    if (req.method === "GET" && req.url === "/middleware/status") {
      writeJson(res, 200, getMiddlewareStats(middlewareMaxPayloadBytes));
      return;
    }

    if (req.method === "POST" && req.url === "/policy/reload") {
      policy
        .reload()
        .then((result) => {
          if (result.ok) {
            const occurredAt = new Date().toISOString();
            for (const digest of result.supersededDigests) {
              linkage.closeGrantsForSupersededDigest(digest, occurredAt);
              void evidence.recordSupersession(digest);
            }
            writeJson(res, 200, { ok: true, policyCount: result.digestCount });
          } else {
            writeJson(res, 503, { ok: false, error: result.error });
          }
        })
        .catch((error: unknown) => {
          writeJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : "unknown error",
          });
        });
      return;
    }

    res.writeHead(404);
    res.end();
  });
  server.listen(port);
  return server;
}
