export type ClosedReason = "sandbox_ended" | "policy_superseded" | "revoked";
export type ObservationKind = "outbound_call" | "data_egress" | "credential_use" | "policy_change";
export type ObservationOutcome = "succeeded" | "denied" | "errored";

// The pure shape attribute.ts matches against - deliberately independent of
// how a grant got into Postgres, so the attribution rule is testable with
// plain objects and no database.
export interface BoundaryGrant {
  id: string;
  sandboxId: string;
  capability: string;
  effectiveFrom: string; // ISO 8601
  effectiveTo: string | null; // ISO 8601, null = still open
}

export interface RawObservation {
  sandboxId: string;
  observedAt: string; // ISO 8601
  capability: string;
}

export interface GrantOpenInput {
  decisionUid: string;
  tenantId: string;
  sandboxId: string;
  capability: string;
  policyDigest: string;
  effectiveFrom: string;
}

export interface RawObservationInput {
  sandboxId: string;
  observedAt: string;
  capability: string;
  kind: ObservationKind;
  destinationHost?: string;
  outcome: ObservationOutcome;
  byteCount?: number;
  detail?: Record<string, unknown>;
}

export interface BoundaryGrantRow {
  id: string;
  decisionUid: string;
  tenantId: string;
  sandboxId: string;
  capability: string;
  policyDigest: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  closedReason: ClosedReason | null;
}

export interface GrantObservationRow {
  id: string;
  grantId: string;
  observedAt: string;
  kind: ObservationKind;
  destinationHost: string | null;
  outcome: ObservationOutcome;
  byteCount: number | null;
  detail: Record<string, unknown> | null;
}

export interface LinkageStats {
  queueDepth: number;
  lastDrainAt: string | null;
  drainLagMs: number | null;
  grantsOpenedTotal: number;
  grantsClosedTotal: number;
  observationsWrittenTotal: number;
  observationsUnattributedTotal: number; // a raw observation that matched zero open grants
  grantOpenSkippedUnresolvedSandboxTotal: number; // sandbox id could not be derived from the response
}
