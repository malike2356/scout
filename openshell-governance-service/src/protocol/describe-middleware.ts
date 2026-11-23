// SupervisorMiddleware implementation: Describe, ValidateConfig, and the two
// request/websocket Evaluate entry points. HttpResponsePreReturn (a separate
// service on the same connection) lives in evaluate.ts - it has no Describe
// RPC of its own; its binding is declared in this manifest.
//
// EvaluateHttpRequest and EvaluateWebSocketSession now answer a real policy
// (prompt 04) via src/middleware/evaluate.ts, reusing the same policy
// snapshot the control-plane interceptor reads - see that module for the
// payload-discipline rules (credential-header assertion, body never stored,
// redaction records field names only).

import { create } from "@bufbuild/protobuf";
import type { ServiceImpl } from "@connectrpc/connect";
import {
  SupervisorMiddleware,
  MiddlewareManifestSchema,
  ValidateConfigResponseSchema,
  HttpRequestResultSchema,
  WebSocketSessionEventResultSchema,
  SupervisorMiddlewareOperation,
  SupervisorMiddlewarePhase,
  Decision,
  WebSocketPreflightAction,
} from "../gen/supervisor_middleware_pb.js";
import { PeerMetadataSchema, ProtocolVersionSchema } from "../gen/extension_pb.js";
import type { ServiceConfig } from "../config.js";
import type { EvidenceWriter } from "../evidence/writer.js";
import type { LinkageWriter } from "../linkage/writer.js";
import { log } from "../log.js";
import { evaluateHttpRequest, evaluateWebSocketSession } from "../middleware/evaluate.js";
import { recordMiddlewareDecision } from "../middleware/stats.js";
import { recordRawRequestIfEnabled } from "../middleware/raw-request-recorder.js";
import type { PolicySnapshotManager } from "../policy/snapshot.js";

// Exact capability string from proto/supervisor_middleware.proto:70.
const SUPERVISOR_MIDDLEWARE_CAPABILITY = "openshell.supervisor-middleware.contract";

// A binding may only LOWER this ceiling, never raise it - Describe must
// advertise a value >= config.maxPayloadBytes, and both are set from the
// same config field so they cannot drift (pitfall in prompt 04's own text).
function maxPayloadBytes(config: ServiceConfig): bigint {
  return BigInt(config.middlewareMaxPayloadBytes);
}

// Only a capped preview, built once, never the whole body - this is the only
// place request/response bytes are touched before being discarded.
const BODY_PREVIEW_CAP_BYTES = 4096;
function previewOf(body: Uint8Array): string | undefined {
  if (body.length === 0) return undefined;
  const slice = body.subarray(0, BODY_PREVIEW_CAP_BYTES);
  return Buffer.from(slice).toString("utf8");
}

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443, ws: 80, wss: 443 };

function buildUrl(target: { scheme: string; host: string; port: number; path: string; query?: string }): string {
  const portSuffix = DEFAULT_PORTS[target.scheme] === target.port ? "" : `:${target.port}`;
  const querySuffix = target.query ? `?${target.query}` : "";
  return `${target.scheme}://${target.host}${portSuffix}${target.path}${querySuffix}`;
}

function headersFrom(headers: readonly { name: string; value: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) result[h.name] = h.value;
  return result;
}

export function buildMiddlewareManifest(config: ServiceConfig) {
  return create(MiddlewareManifestSchema, {
    name: "scout-governance",
    expectedAudience: config.middlewareAudience,
    extension: create(PeerMetadataSchema, {
      protocolVersion: create(ProtocolVersionSchema, { major: 1, minor: 0 }),
      implementationName: config.implementationName,
      implementationVersion: config.implementationVersion,
      supportedCapabilities: [SUPERVISOR_MIDDLEWARE_CAPABILITY],
      requiredCapabilities: [SUPERVISOR_MIDDLEWARE_CAPABILITY],
    }),
    bindings: [
      {
        operation: SupervisorMiddlewareOperation.HTTP_REQUEST,
        phase: SupervisorMiddlewarePhase.PRE_CREDENTIALS,
        maxPayloadBytes: maxPayloadBytes(config),
      },
      {
        operation: SupervisorMiddlewareOperation.HTTP_RESPONSE,
        phase: SupervisorMiddlewarePhase.PRE_RETURN,
        maxPayloadBytes: maxPayloadBytes(config),
      },
    ],
  });
}

export function evidenceModeFor(policyDigest: string): "cached_snapshot" | "fail_closed_default" {
  return policyDigest === "none" ? "fail_closed_default" : "cached_snapshot";
}

export function buildMiddlewareService(
  config: ServiceConfig,
  policy: PolicySnapshotManager,
  evidence: EvidenceWriter,
  linkage: LinkageWriter,
): ServiceImpl<typeof SupervisorMiddleware> {
  return {
    describe(_request) {
      log("middleware_describe_called");
      return buildMiddlewareManifest(config);
    },

    validateConfig(_request) {
      // No middleware-side policy config schema exists yet (policy lives in
      // scout_policy, not in the gateway TOML binding config); everything
      // validates.
      return create(ValidateConfigResponseSchema, { valid: true, reason: "" });
    },

    evaluateHttpRequest(request) {
      // Recorded before any processing at all - the point of the
      // credential-invisibility test is to inspect exactly what this
      // service received, not a version already touched by this handler.
      recordRawRequestIfEnabled("evaluateHttpRequest", {
        context: request.context,
        target: request.target,
        headers: request.headers,
        bodyBase64: Buffer.from(request.body).toString("base64"),
        middlewareName: request.middlewareName,
      });

      const ctx = request.context;
      const target = request.target;
      const headers = headersFrom(request.headers);
      const url = target ? buildUrl(target) : "";

      const startedAt = performance.now();
      const decision = evaluateHttpRequest(
        {
          subject: { tenantId: "default", workspaceId: ctx?.workspace, sandboxId: ctx?.sandboxId },
          method: target?.method ?? "",
          url,
          headers,
          bodyPreview: previewOf(request.body),
          bodySizeBytes: request.body.length,
          correlationId: ctx?.requestId,
        },
        policy.snapshot(),
        config.middlewareMaxPayloadBytes,
      );
      const latencyUs = Math.round((performance.now() - startedAt) * 1000);

      log("middleware_evaluate_http_request", {
        decision: decision.verdict,
        policy_slug: decision.policySlug ?? "",
        policy_digest: decision.policyDigest,
        rule_id: decision.ruleId ?? "",
        redacted_headers: decision.redaction?.header?.length ?? 0,
      });
      recordMiddlewareDecision(decision.verdict, Boolean(decision.redaction));
      const occurredAt = new Date().toISOString();
      evidence.record(
        {
          verdict: decision.verdict,
          policySlug: decision.policySlug ?? "none",
          policyVersion: decision.policyVersion,
          policyDigest: decision.policyDigest,
          ruleId: decision.ruleId,
          reason: decision.reason,
          residualRisk: decision.residualRisk,
          authorityKind: decision.authorityKind,
          authorityRef: decision.authorityRef,
        },
        {
          occurredAt,
          layer: "data",
          rpc: "HttpRequest",
          tenantId: "default",
          workspaceId: ctx?.workspace,
          sandboxId: ctx?.sandboxId,
          correlationId: ctx?.requestId,
          latencyUs,
          evaluationMode: evidenceModeFor(decision.policyDigest),
        },
      );
      // Consequence linkage (prompt 06): "what did the agent do" for
      // whichever grant(s) are open at this moment for this sandbox. Only
      // the request leg is recorded as an observation - the pre-return leg
      // below answers "what did the gateway let back in", not "where did
      // the agent reach", and recording both would double-count one call.
      if (ctx?.sandboxId) {
        linkage.recordObservation({
          sandboxId: ctx.sandboxId,
          observedAt: occurredAt,
          capability: "*",
          kind: "outbound_call",
          destinationHost: target?.host,
          outcome: decision.verdict === "allow" ? "succeeded" : "denied",
          detail: target?.method ? { method: target.method } : undefined,
        });
      }

      if (decision.verdict === "deny") {
        return create(HttpRequestResultSchema, {
          decision: Decision.DENY,
          reason: decision.reason,
          hasBody: false,
          headerMutations: [],
          findings: [],
        });
      }

      // Redaction records a mutation on the named header only - field name,
      // never the value - matching the control-plane patch pattern.
      const headerMutations = (decision.redaction?.header ?? []).map((name) => ({
        operation: { case: "write" as const, value: { name, value: "[REDACTED]" } },
      }));

      return create(HttpRequestResultSchema, {
        decision: Decision.ALLOW,
        reason: decision.reason,
        hasBody: false,
        headerMutations,
        findings: [],
      });
    },

    async *evaluateWebSocketSession(requests) {
      for await (const event of requests) {
        if (event.event.case === "preflight") {
          const preflight = event.event.value;
          const decision = evaluateWebSocketSession(
            {
              subject: {
                tenantId: "default",
                workspaceId: preflight.context?.workspace,
                sandboxId: preflight.context?.sandboxId,
              },
              url: preflight.target ? buildUrl(preflight.target) : "",
              // WebSocketPreflight carries no headers field in the proto -
              // only the upgrade target and requested subprotocols.
              headers: {},
              correlationId: preflight.context?.requestId,
            },
            policy.snapshot(),
          );

          log("middleware_evaluate_websocket_session", {
            decision: decision.verdict,
            policy_slug: decision.policySlug ?? "",
            policy_digest: decision.policyDigest,
            rule_id: decision.ruleId ?? "",
          });
          recordMiddlewareDecision(decision.verdict, Boolean(decision.redaction));
          const occurredAt = new Date().toISOString();
          evidence.record(
            {
              verdict: decision.verdict,
              policySlug: decision.policySlug ?? "none",
              policyVersion: decision.policyVersion,
              policyDigest: decision.policyDigest,
              ruleId: decision.ruleId,
              reason: decision.reason,
              residualRisk: decision.residualRisk,
              authorityKind: decision.authorityKind,
              authorityRef: decision.authorityRef,
            },
            {
              occurredAt,
              layer: "data",
              rpc: "WebSocketSession",
              tenantId: "default",
              workspaceId: preflight.context?.workspace,
              sandboxId: preflight.context?.sandboxId,
              correlationId: preflight.context?.requestId,
              evaluationMode: evidenceModeFor(decision.policyDigest),
            },
          );
          if (preflight.context?.sandboxId) {
            linkage.recordObservation({
              sandboxId: preflight.context.sandboxId,
              observedAt: occurredAt,
              capability: "*",
              kind: "outbound_call",
              destinationHost: preflight.target?.host,
              outcome: decision.verdict === "allow" ? "succeeded" : "denied",
            });
          }

          yield create(WebSocketSessionEventResultSchema, {
            result: {
              case: "preflightDecision",
              value:
                decision.verdict === "deny"
                  ? {
                      action: WebSocketPreflightAction.DENY,
                      reason: decision.reason,
                    }
                  : {
                      action: WebSocketPreflightAction.INSPECT,
                      reason: decision.reason,
                    },
            },
          });
        }
        // session_start, message, and session_end carry no result in this
        // implementation - there is no per-frame hook (do not claim one);
        // session_end in particular "has no result" per the proto.
      }
    },
  };
}
