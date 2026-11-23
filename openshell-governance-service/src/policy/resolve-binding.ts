// Single implementation of binding precedence. Most specific wins:
// workspace > tenant > policy > global. A workspace is a subdivision of a
// tenant, so it outranks it; "policy" (bound by the OpenShell sandbox
// policy name the caller's request carries) is a cross-cutting dimension
// that outranks only the catch-all global default.
//
// Within one subject_kind, `scout_policy_binding.priority` (lower wins) is
// a tie-break for multiple candidate rows - not reachable today given the
// table's UNIQUE(subject_kind, subject_key) constraint, but the comparison
// exists so a future relaxation of that constraint does not silently change
// behavior.

import type { PolicyBinding, SubjectKind } from "./types.js";

const PRECEDENCE: SubjectKind[] = ["workspace", "tenant", "policy", "global"];

// Generalized over both control-plane (BoundaryRequest) and data-plane
// (OutboundRequest/SessionDescriptor/InboundResponse) request shapes - all
// of them carry `subject`, and `operation` is optional (the data plane has
// no equivalent of a sandbox policy name to key the "policy" level on).
export interface BindingSubjectRequest {
  subject: { tenantId: string; workspaceId?: string; sandboxId?: string };
  operation?: Record<string, unknown>;
}

export function subjectKeyFor(kind: SubjectKind, request: BindingSubjectRequest): string | undefined {
  switch (kind) {
    case "workspace":
      return request.subject.workspaceId;
    case "tenant":
      return request.subject.tenantId;
    case "policy":
      return typeof request.operation?.sandboxPolicyName === "string"
        ? (request.operation.sandboxPolicyName as string)
        : undefined;
    case "global":
      return "*";
  }
}

export function resolveBinding(
  bindings: readonly PolicyBinding[],
  request: BindingSubjectRequest,
): PolicyBinding | undefined {
  for (const kind of PRECEDENCE) {
    const key = subjectKeyFor(kind, request);
    if (key === undefined) continue;
    const candidates = bindings.filter((b) => b.subjectKind === kind && b.subjectKey === key);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates[0];
  }
  return undefined;
}
