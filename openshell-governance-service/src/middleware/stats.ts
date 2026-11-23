// In-memory counters for GET /middleware/status. Process-local, reset on
// restart - this is an operator diagnostic, not an evidence store (that is
// prompt 05's job).

export interface MiddlewareStats {
  maxPayloadBytes: number;
  decisionsServed: number;
  denials: number;
  redactions: number;
}

let decisionsServed = 0;
let denials = 0;
let redactions = 0;

export function recordMiddlewareDecision(
  verdict: "allow" | "deny",
  redacted: boolean,
): void {
  decisionsServed += 1;
  if (verdict === "deny") denials += 1;
  if (redacted) redactions += 1;
}

export function getMiddlewareStats(maxPayloadBytes: number): MiddlewareStats {
  return { maxPayloadBytes, decisionsServed, denials, redactions };
}
