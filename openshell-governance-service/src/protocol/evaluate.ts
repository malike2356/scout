// HttpResponsePreReturn: the streamed response-evaluation service. Declared
// via the HTTP_RESPONSE/PRE_RETURN binding in describe-middleware.ts, served
// as a separate gRPC service on the same connection. No Describe RPC of its
// own - the proto defines none.
//
// This evaluates at preflight only (status code + headers, before any body
// unit arrives) and answers skip/block based on the same policy snapshot
// the control plane and EvaluateHttpRequest read. Body-unit-level inspection
// (actually reading response bytes) is out of scope for this prompt's
// implementation - "HttpResponsePreReturn is streamed; evaluate
// incrementally and discard" governs any future prompt that adds it; this
// one does not buffer or inspect bodies at all, which trivially satisfies
// the "never buffer the whole response" rule by not touching the body.

import { create } from "@bufbuild/protobuf";
import type { ServiceImpl } from "@connectrpc/connect";
import {
  HttpResponsePreReturn,
  HttpResponseEventResultSchema,
} from "../gen/supervisor_middleware_pb.js";
import type { EvidenceWriter } from "../evidence/writer.js";
import { log } from "../log.js";
import { evaluatePreReturn } from "../middleware/evaluate.js";
import { recordMiddlewareDecision } from "../middleware/stats.js";
import type { PolicySnapshotManager } from "../policy/snapshot.js";
import { evidenceModeFor } from "./describe-middleware.js";

function headersFrom(headers: readonly { name: string; value: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) result[h.name] = h.value;
  return result;
}

export function buildHttpResponsePreReturnService(
  policy: PolicySnapshotManager,
  evidence: EvidenceWriter,
): ServiceImpl<typeof HttpResponsePreReturn> {
  return {
    async *evaluate(requests) {
      for await (const event of requests) {
        if (event.event.case === "preflight") {
          const preflight = event.event.value;
          const ctx = preflight.context;

          const decision = evaluatePreReturn(
            {
              subject: { tenantId: "default", workspaceId: ctx?.workspace, sandboxId: ctx?.sandboxId },
              statusCode: preflight.statusCode,
              headers: headersFrom(preflight.headers),
              bodySizeBytes: 0, // no body available at preflight; see module note above
              correlationId: ctx?.requestId,
            },
            policy.snapshot(),
            Number(preflight.maxPayloadBytes),
          );

          log("middleware_evaluate_pre_return", {
            decision: decision.verdict,
            policy_slug: decision.policySlug ?? "",
            policy_digest: decision.policyDigest,
            rule_id: decision.ruleId ?? "",
          });
          recordMiddlewareDecision(decision.verdict, Boolean(decision.redaction));
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
              occurredAt: new Date().toISOString(),
              layer: "data",
              rpc: "HttpResponse",
              phase: "pre_return",
              tenantId: "default",
              workspaceId: ctx?.workspace,
              sandboxId: ctx?.sandboxId,
              correlationId: ctx?.requestId,
              evaluationMode: evidenceModeFor(decision.policyDigest),
            },
          );

          if (decision.verdict === "deny") {
            yield create(HttpResponseEventResultSchema, {
              result: {
                case: "preflightResult",
                value: {
                  action: { case: "blockDelivery", value: {} },
                  reason: decision.reason,
                  reasonCode: "scout_policy_denied",
                },
              },
            });
            continue;
          }

          // "Deliver unchanged without invoking on_error" - the simplest
          // correct allow for this stage: skip ends the stage with no body
          // inspection, so no later body/trailers events are expected for
          // this evaluation.
          yield create(HttpResponseEventResultSchema, {
            result: { case: "preflightResult", value: { action: { case: "skip", value: {} } } },
          });
        }
        // body, trailers, and session_end are not expected after a skip or
        // block decision; this implementation does not emit results for them.
      }
    },
  };
}
