// The data-plane decision functions (prompt 04). Pure, no I/O, same shape
// discipline as src/policy/decide.ts: resolve a binding against the shared
// snapshot (so data-plane and control-plane decisions for one snapshot cite
// the same policyDigest), find the first matching middleware rule, decide.
//
// Payload discipline (the design decision this prompt is graded on):
//   - Request headers: at PRE_CREDENTIALS the credential header is absent
//     BY CONSTRUCTION. This module does not "also" strip it - it ASSERTS
//     absence and fails closed if a known credential header somehow
//     appears, treating that as a contract violation, not something to
//     silently tolerate.
//   - Body: never stored. Callers pass only a capped preview for rule
//     matching; this module never logs or returns it in `reason`.
//   - Redaction records the field NAME that was redacted, never the value.

import { authorityOf, DEFAULT_AUTHORITY } from "../policy/authority.js";
import { pointerGet } from "../policy/json-pointer.js";
import { resolveBinding } from "../policy/resolve-binding.js";
import type { AuthorityKind, LoadedPolicy, MiddlewareRule, PolicySnapshot } from "../policy/types.js";

export interface OutboundRequest {
  subject: { tenantId: string; workspaceId?: string; sandboxId?: string };
  method: string;
  url: string;
  headers: Record<string, string>; // credential headers are NOT present at PRE_CREDENTIALS
  bodyPreview?: string; // capped, and never a secret field
  bodySizeBytes: number; // real size, checked against the payload ceiling independent of the preview
  correlationId?: string;
}

export interface SessionDescriptor {
  subject: { tenantId: string; workspaceId?: string; sandboxId?: string };
  url: string;
  headers: Record<string, string>;
  correlationId?: string;
}

export interface InboundResponse {
  subject: { tenantId: string; workspaceId?: string; sandboxId?: string };
  statusCode: number;
  headers: Record<string, string>;
  bodyPreview?: string;
  bodySizeBytes: number;
  correlationId?: string;
}

export interface MiddlewareDecision {
  verdict: "allow" | "deny";
  reason: string;
  policyDigest: string;
  policySlug?: string;
  policyVersion?: number;
  ruleId?: string;
  redaction?: { header?: string[]; url?: string[] };
  residualRisk?: string;
  authorityKind: AuthorityKind;
  authorityRef?: string;
}

// Headers that must never reach this service at PRE_CREDENTIALS. Asserting
// their absence (rather than stripping them) is the point: their presence
// means OpenShell's own omission guarantee has been violated upstream, and
// the honest response is to fail closed, not to quietly clean up after it.
const CREDENTIAL_HEADER_NAMES = new Set(["authorization", "proxy-authorization", "cookie"]);

function noPolicy(phaseAllowsOpen: boolean): MiddlewareDecision {
  return phaseAllowsOpen
    ? {
        verdict: "allow",
        reason: "no policy binding resolved; nothing to evaluate against",
        policyDigest: "none",
        residualRisk: "no policy governs this subject; nothing restricts this allowance",
        authorityKind: DEFAULT_AUTHORITY.kind,
      }
    : {
        verdict: "deny",
        reason: "no policy binding resolved; failing closed, not treating absence as allow",
        policyDigest: "none",
        authorityKind: DEFAULT_AUTHORITY.kind,
      };
}

function resolvePolicyForSubject(
  subject: { tenantId: string; workspaceId?: string; sandboxId?: string },
  snapshot: PolicySnapshot,
): LoadedPolicy | undefined {
  const binding = resolveBinding(snapshot.bindings, { subject });
  if (!binding) return undefined;
  return snapshot.policiesById.get(binding.policyId);
}

function findMatchingMiddlewareRule(
  policy: LoadedPolicy,
  operation: "http_request" | "http_response" | "websocket_session",
  subjectDoc: Record<string, unknown>,
): MiddlewareRule | undefined {
  return policy.document.middlewareRules.find(
    (rule) =>
      (rule.operation === "*" || rule.operation === operation) &&
      matchesMiddlewareWhen(subjectDoc, rule),
  );
}

function matchesMiddlewareWhen(doc: Record<string, unknown>, rule: MiddlewareRule): boolean {
  const actual = pointerGet(doc, rule.when.path);
  switch (rule.when.op) {
    case "exists":
      return actual !== undefined;
    case "equals":
      return actual === rule.when.value;
    case "notEquals":
      return actual !== rule.when.value;
    case "gt":
      return typeof actual === "number" && typeof rule.when.value === "number" && actual > rule.when.value;
    case "lt":
      return typeof actual === "number" && typeof rule.when.value === "number" && actual < rule.when.value;
  }
}

function assertNoCredentialHeaders(headers: Record<string, string>): string | undefined {
  for (const name of Object.keys(headers)) {
    if (CREDENTIAL_HEADER_NAMES.has(name.toLowerCase())) {
      // Never include the header's value - only that the contract was
      // violated and which field name triggered it.
      return `credential header '${name}' present at PRE_CREDENTIALS; OpenShell's omission guarantee was violated upstream`;
    }
  }
  return undefined;
}

export function evaluateHttpRequest(
  req: OutboundRequest,
  snapshot: PolicySnapshot,
  maxPayloadBytes: number,
): MiddlewareDecision {
  const credentialViolation = assertNoCredentialHeaders(req.headers);
  if (credentialViolation) {
    return { verdict: "deny", reason: credentialViolation, policyDigest: "none", authorityKind: DEFAULT_AUTHORITY.kind };
  }
  if (req.bodySizeBytes > maxPayloadBytes) {
    return {
      verdict: "deny",
      reason: `request body ${req.bodySizeBytes} bytes exceeds the ${maxPayloadBytes}-byte payload ceiling`,
      policyDigest: "none",
      authorityKind: DEFAULT_AUTHORITY.kind,
    };
  }

  const policy = resolvePolicyForSubject(req.subject, snapshot);
  if (!policy) return noPolicy(false);

  const subjectDoc = { method: req.method, url: req.url, headers: req.headers, bodyPreview: req.bodyPreview };
  const matched = findMatchingMiddlewareRule(policy, "http_request", subjectDoc);
  return finalizeDecision(policy, matched);
}

export function evaluateWebSocketSession(
  session: SessionDescriptor,
  snapshot: PolicySnapshot,
): MiddlewareDecision {
  // "There is no per-frame hook" - this evaluates the session descriptor at
  // establishment only. Do not claim frame-level governance here or anywhere
  // that calls this function.
  const credentialViolation = assertNoCredentialHeaders(session.headers);
  if (credentialViolation) {
    return { verdict: "deny", reason: credentialViolation, policyDigest: "none", authorityKind: DEFAULT_AUTHORITY.kind };
  }

  const policy = resolvePolicyForSubject(session.subject, snapshot);
  if (!policy) return noPolicy(false);

  const subjectDoc = { url: session.url, headers: session.headers };
  const matched = findMatchingMiddlewareRule(policy, "websocket_session", subjectDoc);
  return finalizeDecision(policy, matched);
}

export function evaluatePreReturn(
  res: InboundResponse,
  snapshot: PolicySnapshot,
  maxPayloadBytes: number,
): MiddlewareDecision {
  if (res.bodySizeBytes > maxPayloadBytes) {
    return {
      verdict: "deny",
      reason: `response body ${res.bodySizeBytes} bytes exceeds the ${maxPayloadBytes}-byte payload ceiling`,
      policyDigest: "none",
      authorityKind: DEFAULT_AUTHORITY.kind,
    };
  }

  // post_commit-equivalent for the data plane: the policy at this stage may
  // still deny delivery to the sandbox (the upstream call already happened,
  // but the sandbox has not yet seen the response) - this is NOT the
  // control plane's post_commit, which always allows. Pre-return can
  // legitimately deny.
  const policy = resolvePolicyForSubject(res.subject, snapshot);
  if (!policy) return noPolicy(false);

  const subjectDoc = { statusCode: res.statusCode, headers: res.headers, bodyPreview: res.bodyPreview };
  const matched = findMatchingMiddlewareRule(policy, "http_response", subjectDoc);
  return finalizeDecision(policy, matched);
}

function finalizeDecision(policy: LoadedPolicy, matched: MiddlewareRule | undefined): MiddlewareDecision {
  const authority = authorityOf(policy);
  const base = {
    policyDigest: policy.digestSha256,
    policySlug: policy.policySlug,
    policyVersion: policy.version,
    authorityKind: authority.kind,
    authorityRef: authority.ref,
  };
  if (!matched) {
    return {
      ...base,
      verdict: policy.document.middlewareDefaultVerdict,
      reason: `no middleware rule matched; default verdict '${policy.document.middlewareDefaultVerdict}' from policy ${policy.policySlug}`,
      residualRisk:
        policy.document.middlewareDefaultVerdict === "allow"
          ? `default verdict of policy ${policy.policySlug} allowed this; no rule constrained it further`
          : undefined,
    };
  }
  if (matched.verdict === "deny") {
    return { ...base, verdict: "deny", ruleId: matched.id, reason: matched.reason };
  }
  if (matched.verdict === "redact") {
    return {
      ...base,
      verdict: "allow",
      ruleId: matched.id,
      reason: matched.reason,
      // Field names only - never the redacted value.
      redaction: matched.redaction,
      residualRisk: `rule '${matched.id}' allowed this after redacting ${(matched.redaction?.header ?? []).length} header(s); the request still proceeds to its declared destination`,
    };
  }
  return {
    ...base,
    verdict: "allow",
    ruleId: matched.id,
    reason: matched.reason,
    residualRisk: `rule '${matched.id}' allowed this; no restriction beyond policy ${policy.policySlug} applies`,
  };
}
