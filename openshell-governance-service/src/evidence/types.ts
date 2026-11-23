import type { AuthorityKind, Verdict } from "../policy/types.js";

export type Layer = "control" | "data";
export type EvaluationMode = "cached_snapshot" | "fail_closed_default";
export type ActorKind = "human" | "agent" | "system";
export type ProvenanceEvent = "authored" | "signed" | "activated" | "superseded" | "revoked";

// What a protocol handler already knows about the request, independent of
// the decision itself - the writer combines this with a BoundaryDecision or
// MiddlewareDecision to build one full row.
export interface DecisionContext {
  // Set by the caller when it also needs to correlate this decision with a
  // boundary_grant row (prompt 06) - lets two independent writers agree on
  // one decision_uid without EvidenceWriter exposing its row shape to
  // LinkageWriter. record() generates its own when this is absent.
  decisionUid?: string;
  correlationId?: string;
  occurredAt: string; // ISO 8601, caller's clock read - the writer takes no clock reads of its own
  layer: Layer;
  rpc: string;
  phase?: string;
  tenantId: string;
  workspaceId?: string;
  sandboxId?: string;
  subjectLabel?: string; // sandbox/workspace name - never an email
  latencyUs?: number;
  evaluationMode: EvaluationMode;
}

export interface DecisionForEvidence {
  verdict: Verdict;
  policySlug: string;
  policyVersion?: number;
  policyDigest: string;
  ruleId?: string;
  reason: string;
  residualRisk?: string;
  authorityKind: AuthorityKind;
  authorityRef?: string;
}

export interface BoundaryDecisionRow {
  decisionUid: string;
  correlationId: string | null;
  occurredAt: string;
  layer: Layer;
  rpc: string;
  phase: string | null;
  tenantId: string;
  workspaceId: string | null;
  sandboxId: string | null;
  subjectLabel: string | null;
  verdict: Verdict;
  ruleId: string | null;
  reason: string;
  policySlug: string;
  policyVersion: number;
  policyDigest: string;
  authorityKind: AuthorityKind;
  authorityRef: string | null;
  residualRisk: string | null;
  latencyUs: number | null;
  evaluationMode: EvaluationMode;
  serviceVersion: string;
}

export interface PolicyProvenanceRow {
  policyDigest: string;
  policySlugForLookup: string;
  policyVersionForLookup: number;
  event: ProvenanceEvent;
  actor: string;
  actorKind: ActorKind;
  signatureSubject?: string;
  note?: string;
}

export interface EvidenceStats {
  queueDepth: number;
  oldestQueuedAgeMs: number | null;
  drainLagMs: number | null;
  lastDrainAt: string | null;
  decisionsWrittenTotal: number;
  writeFailuresTotal: number;
  deadLetterTotal: number;
  droppedDueToFullBufferTotal: number;
  refusedIncompleteTotal: number;
}
