// GatewayInterceptor implementation: Describe + Evaluate.
// Evaluate now answers a real, versioned policy (prompt 03) instead of the
// prompt-02 hardcoded allow.

import { randomUUID } from "node:crypto";
import { create, fromJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import type { ServiceImpl } from "@connectrpc/connect";
import {
  GatewayInterceptor,
  InterceptorManifestSchema,
  InterceptorResultSchema,
  ProviderProfileSnapshotSchema,
  GatewayInterceptorPhase,
} from "../gen/gateway_interceptor_pb.js";
import { PeerMetadataSchema, ProtocolVersionSchema } from "../gen/extension_pb.js";
import type { ServiceConfig } from "../config.js";
import type { EvidenceWriter } from "../evidence/writer.js";
import type { LinkageWriter } from "../linkage/writer.js";
import { log } from "../log.js";
import { decide } from "../policy/decide.js";
import { pointerGet } from "../policy/json-pointer.js";
import type { PolicySnapshotManager } from "../policy/snapshot.js";
import type { BoundaryRequest, Phase } from "../policy/types.js";

// Exact capability string from proto/gateway_interceptor.proto:114 - read from
// the proto comment, never retyped from the README.
const GATEWAY_INTERCEPTOR_CAPABILITY = "openshell.gateway-interceptor.contract";

// The control-plane surface Scout governs per the prompt's own framing:
// "every sandbox creation, provider attachment, access-surface change,
// credential rotation and policy edit". Deliberately excludes
// ImportProviderProfiles/UpdateProviderProfiles/DeleteProviderProfile and the
// policy-proposal RPCs (SubmitPolicyAnalysis, Approve/Reject/Edit/Undo/Clear
// DraftChunk) - those are the provider-profile-governance reference
// example's territory (prompt 01), not Scout's, per the "resist
// re-implementing what NVIDIA already demonstrates" pitfall.
//
// Four of these - CreateSandbox, AttachSandboxProvider, ExposeService,
// DeleteSandbox - also carry POST_COMMIT in their binding below (prompt 06's
// grant lifecycle needs the response, not the request, to learn the
// gateway's real sandbox id). A live gateway run discovered a real
// constraint while building that: it refuses a manifest declaring two
// separate bindings for the same RPC ("declared multiple bindings for
// configured RPC"), so post_commit cannot be a second, separately-failing
// binding alongside VALIDATE - it has to join the SAME binding. The proto's
// own rule ("bindings that include post_commit must resolve to fail_open")
// then applies to the WHOLE binding, not just its post_commit phase. That is
// a real, narrow cost: for exactly these four RPCs, if Scout becomes
// unreachable, VALIDATE now fails open too, not just post_commit. The other
// ten RPCs below keep the fail_closed guarantee prompt 03 proved untouched.
export const VALIDATE_ONLY_RPCS = [
  "DetachSandboxProvider",
  "CreateSshSession",
  "RevokeSshSession",
  "DeleteService",
  "CreateProvider",
  "UpdateProvider",
  "DeleteProvider",
  "ConfigureProviderRefresh",
  "RotateProviderCredential",
  "DeleteProviderRefresh",
  "UpdateConfig",
];

// Grant-lifecycle RPCs (prompt 06) - VALIDATE + POST_COMMIT in one binding,
// fail_open overall, for the reason documented above.
export const GRANT_LIFECYCLE_RPCS = ["CreateSandbox", "AttachSandboxProvider", "ExposeService", "DeleteSandbox"];

export function buildInterceptorManifest(config: ServiceConfig) {
  return create(InterceptorManifestSchema, {
    name: "scout-governance",
    failurePolicy: "fail_closed",
    providerProfiles: false,
    expectedAudience: config.interceptorAudience,
    extension: create(PeerMetadataSchema, {
      protocolVersion: create(ProtocolVersionSchema, {
        major: config.debugProtocolMajorOverride ?? 1,
        minor: 0,
      }),
      implementationName: config.implementationName,
      implementationVersion: config.implementationVersion,
      supportedCapabilities: [GATEWAY_INTERCEPTOR_CAPABILITY],
      requiredCapabilities: [GATEWAY_INTERCEPTOR_CAPABILITY],
    }),
    bindings: [
      {
        id: "scout-create-sandbox-decide",
        selector: { rpc: "openshell.v1.OpenShell/CreateSandbox" },
        phases: [
          GatewayInterceptorPhase.MODIFY_OPERATION,
          GatewayInterceptorPhase.VALIDATE,
          GatewayInterceptorPhase.POST_COMMIT,
        ],
        // fail_open: required because this binding includes post_commit
        // (see GRANT_LIFECYCLE_RPCS comment above) - the real, narrow cost
        // is that modify_operation/validate also fail open on Scout being
        // unreachable, not only post_commit.
        failurePolicy: "fail_open",
      },
      ...VALIDATE_ONLY_RPCS.map((method) => ({
        id: `scout-${method.toLowerCase()}-decide`,
        selector: { rpc: `openshell.v1.OpenShell/${method}` },
        phases: [GatewayInterceptorPhase.VALIDATE],
        failurePolicy: "fail_closed" as const,
      })),
      ...GRANT_LIFECYCLE_RPCS.filter((method) => method !== "CreateSandbox").map((method) => ({
        id: `scout-${method.toLowerCase()}-decide`,
        selector: { rpc: `openshell.v1.OpenShell/${method}` },
        phases: [GatewayInterceptorPhase.VALIDATE, GatewayInterceptorPhase.POST_COMMIT],
        failurePolicy: "fail_open" as const,
      })),
    ],
  });
}

function phaseOf(evalCase: "modifyOperation" | "validate" | "postCommit" | undefined): Phase {
  switch (evalCase) {
    case "modifyOperation":
      return "modify_operation";
    case "postCommit":
      return "post_commit";
    default:
      return "validate";
  }
}

function shortMethodName(rpc: string): string {
  const idx = rpc.lastIndexOf("/");
  return idx === -1 ? rpc : rpc.slice(idx + 1);
}

// Sandbox identity for the grant lifecycle (prompt 06). Every path below is
// read from the RESPONSE MESSAGE SHAPE declared in openshell.proto, not
// guessed from runtime behaviour: SandboxResponse.sandbox.metadata.id and
// AttachSandboxProviderResponse.sandbox.metadata.id (field 1 on both),
// ServiceEndpointResponse.endpoint.sandbox_id (ServiceEndpoint field 2,
// explicitly "Sandbox object ID"), DeleteSandboxResponse.sandbox_id (field
// 3, "Immutable identity of the targeted sandbox"). This is also why grant
// opening happens at post_commit rather than validate: the request side of
// these RPCs identifies a sandbox by its human-reusable NAME, but the data
// plane's RequestContext.sandbox_id - what an observation will carry - is
// the gateway's stable id, only present in the committed response.
function sandboxIdFromPostCommit(method: string, operation: Record<string, unknown>): string | undefined {
  let value: unknown;
  switch (method) {
    case "CreateSandbox":
    case "AttachSandboxProvider":
      value = pointerGet(operation, "/sandbox/metadata/id");
      break;
    case "ExposeService":
      value = pointerGet(operation, "/endpoint/sandboxId");
      break;
    case "DeleteSandbox":
      value = operation.sandboxId;
      break;
    default:
      return undefined;
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// AttachSandboxProviderResponse does not echo back which provider was
// attached (only `sandbox`, `attached`, `receipt`) - the provider name lives
// in the VALIDATE-phase request, which this post_commit evaluation does not
// have. The capability is deliberately left coarse rather than fabricated;
// narrowing it would need correlating two separate Evaluate calls, which is
// not attempted here.
function capabilityFromPostCommit(method: string, operation: Record<string, unknown>): string {
  if (method === "ExposeService") {
    const name = pointerGet(operation, "/endpoint/name");
    return typeof name === "string" && name.length > 0 ? `service:${name}` : "service";
  }
  if (method === "AttachSandboxProvider") return "provider";
  return "*";
}

function operationOf(
  phase: { case: string | undefined; value?: { proposedOperation?: object; committedResponse?: object } },
): Record<string, unknown> {
  if (phase.case === "postCommit") {
    return (phase.value?.committedResponse as Record<string, unknown>) ?? {};
  }
  return (phase.value?.proposedOperation as Record<string, unknown>) ?? {};
}

export function buildInterceptorService(
  config: ServiceConfig,
  policy: PolicySnapshotManager,
  evidence: EvidenceWriter,
  linkage: LinkageWriter,
): ServiceImpl<typeof GatewayInterceptor> {
  return {
    describe(_request) {
      log("interceptor_describe_called");
      return buildInterceptorManifest(config);
    },

    snapshotProviderProfiles(_request) {
      return create(ProviderProfileSnapshotSchema, {
        revision: "scout-governance-skeleton-empty",
        profiles: [],
      });
    },

    evaluate(request) {
      const operation = operationOf(request.phase);
      const boundaryRequest: BoundaryRequest = {
        rpc: request.method || request.service,
        phase: phaseOf(request.phase.case),
        subject: {
          // Real multi-tenant subject derivation is prompt 09's job (this
          // programme's "multi-tenant isolation and policy distribution").
          // A placeholder tenant keeps the binding-precedence levels above
          // it (workspace, then tenant) exercisable without inventing a
          // tenancy model this prompt does not own.
          tenantId: "default",
          workspaceId:
            typeof (operation.workspaceScope as Record<string, unknown> | undefined)?.workspace ===
            "string"
              ? ((operation.workspaceScope as Record<string, unknown>).workspace as string)
              : "default",
        },
        operation,
        correlationId: request.bindingId,
      };

      const startedAt = performance.now();
      const decision = decide(boundaryRequest, policy.snapshot());
      const latencyUs = Math.round((performance.now() - startedAt) * 1000);
      const occurredAt = new Date().toISOString();
      const decisionUid = randomUUID();
      const method = shortMethodName(boundaryRequest.rpc);
      // post_commit is the only phase where this handler ever learns the
      // gateway's real sandbox id (see sandboxIdFromPostCommit) - record it
      // on the evidence row too, not only on the grant, so an operator
      // reading /evidence/decisions can find it without already knowing
      // the decision_uid to look up via /linkage.
      const resolvedSandboxId =
        boundaryRequest.phase === "post_commit"
          ? sandboxIdFromPostCommit(method, operation)
          : boundaryRequest.subject.sandboxId;

      log("interceptor_evaluate", {
        binding_id: request.bindingId,
        method: request.method,
        phase: boundaryRequest.phase,
        verdict: decision.verdict,
        policy_slug: decision.policySlug,
        policy_digest: decision.policyDigest,
        rule_id: decision.ruleId ?? "",
      });

      evidence.record(
        {
          verdict: decision.verdict,
          policySlug: decision.policySlug,
          policyVersion: decision.policyVersion,
          policyDigest: decision.policyDigest,
          ruleId: decision.ruleId,
          reason: decision.reason,
          residualRisk: decision.residualRisk,
          authorityKind: decision.authorityKind,
          authorityRef: decision.authorityRef,
        },
        {
          decisionUid,
          occurredAt,
          layer: "control",
          rpc: boundaryRequest.rpc,
          phase: boundaryRequest.phase,
          tenantId: boundaryRequest.subject.tenantId,
          workspaceId: boundaryRequest.subject.workspaceId,
          sandboxId: resolvedSandboxId,
          correlationId: boundaryRequest.correlationId,
          latencyUs,
          evaluationMode: decision.policySlug === "none" || decision.policySlug === "unknown" ? "fail_closed_default" : "cached_snapshot",
        },
      );

      // Grant lifecycle (prompt 06) - post_commit only, and only for the
      // RPCs whose committed response carries a resolvable sandbox id. A
      // deny can never reach here for these RPCs' VALIDATE binding, but
      // post_commit always allows by construction (decide.ts), so the
      // verdict check below is belt-and-suspenders, not load-bearing.
      if (boundaryRequest.phase === "post_commit" && decision.verdict === "allow") {
        if (method === "DeleteSandbox") {
          if (resolvedSandboxId) linkage.closeGrantsForSandbox(resolvedSandboxId, "sandbox_ended", occurredAt);
        } else if (GRANT_LIFECYCLE_RPCS.includes(method)) {
          linkage.openGrant({
            decisionUid,
            tenantId: boundaryRequest.subject.tenantId,
            sandboxId: resolvedSandboxId,
            capability: capabilityFromPostCommit(method, operation),
            policyDigest: decision.policyDigest,
            effectiveFrom: occurredAt,
          });
        }
      }

      return create(InterceptorResultSchema, {
        allowed: decision.verdict === "allow",
        reason: decision.reason,
        statusCode: decision.verdict === "deny" ? "PERMISSION_DENIED" : "",
        patches: (decision.patches ?? []).map((p) => ({
          op: p.op,
          path: p.path,
          value: fromJson(ValueSchema, (p.value ?? null) as never),
        })),
        logAnnotations: {
          policy_slug: decision.policySlug,
          policy_digest: decision.policyDigest,
          rule_id: decision.ruleId ?? "",
        },
      });
    },
  };
}
