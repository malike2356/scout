export type Phase = "modify_operation" | "validate" | "post_commit";
export type Verdict = "allow" | "deny";
export type SubjectKind = "tenant" | "workspace" | "policy" | "global";

export interface BoundaryRequest {
  rpc: string; // short method name, e.g. "CreateSandbox"
  phase: Phase;
  subject: { tenantId: string; workspaceId?: string; sandboxId?: string };
  operation: Record<string, unknown>; // secret-marked fields are already omitted BY OPENSHELL
  correlationId?: string;
}

// 'owner' - an unsigned policy a solo operator authored directly.
// 'signed_policy' - the loaded policy row carries a signature.
// 'delegated' - reserved for prompt 09 (multi-tenant policy distribution);
// not produced by this prompt's code paths yet.
// 'default' - no policy was actually consulted (no binding resolved, the
// binding pointed at a policy not in the snapshot, or a payload/credential
// safety check short-circuited before any policy lookup).
export type AuthorityKind = "owner" | "signed_policy" | "delegated" | "default";

export interface BoundaryDecision {
  verdict: Verdict;
  policySlug: string;
  policyVersion?: number;
  policyDigest: string;
  ruleId?: string;
  reason: string; // one line, no secret material
  residualRisk?: string;
  patches?: JsonPatchOp[]; // modify_operation only
  authorityKind: AuthorityKind;
  authorityRef?: string; // signature subject (signed_policy) or policy slug (owner)
}

export interface JsonPatchOp {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

export type RuleOperator = "equals" | "notEquals" | "exists" | "gt" | "lt";

export interface PolicyRuleWhen {
  path: string; // RFC 6901 JSON pointer into `operation`
  op: RuleOperator;
  value?: unknown;
}

export interface PolicyRule {
  id: string;
  rpc: string; // exact short RPC name, or "*" for any
  when: PolicyRuleWhen;
  verdict: Verdict;
  reason: string;
}

export interface PolicyPatchRule {
  rpc: string;
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

export type MiddlewareVerdict = "allow" | "deny" | "redact";
export type MiddlewareOperation = "http_request" | "http_response" | "websocket_session";

export interface MiddlewareRuleWhen {
  path: string; // RFC 6901 JSON pointer into the flattened evaluation subject
  op: RuleOperator;
  value?: unknown;
}

export interface MiddlewareRedactionSpec {
  header?: string[];
  url?: string[];
}

export interface MiddlewareRule {
  id: string;
  operation: MiddlewareOperation | "*";
  when: MiddlewareRuleWhen;
  verdict: MiddlewareVerdict;
  reason: string;
  redaction?: MiddlewareRedactionSpec; // only meaningful when verdict is "redact"
}

export interface PolicyDocument {
  rules: PolicyRule[];
  defaultVerdict: Verdict;
  patches: PolicyPatchRule[];
  // Data-plane (prompt 04). Lives in the same document as the control-plane
  // rules above so both planes cite the same policyDigest for one snapshot.
  middlewareRules: MiddlewareRule[];
  middlewareDefaultVerdict: Verdict;
}

export interface LoadedPolicy {
  id: string;
  policySlug: string;
  version: number;
  digestSha256: string;
  document: PolicyDocument;
  signature?: string;
  signedBy?: string;
}

export interface PolicyBinding {
  subjectKind: SubjectKind;
  subjectKey: string;
  policyId: string;
  priority: number;
}

export interface PolicySnapshot {
  loadedAt: string;
  policiesById: Map<string, LoadedPolicy>;
  bindings: PolicyBinding[];
}
