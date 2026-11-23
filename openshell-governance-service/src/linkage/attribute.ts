// The attribution rule, implemented once per prompt 06's own pitfall: "which
// observations belong to which grant" must be one tested function, not
// re-derived per query.
//
// An observation belongs to a grant when ALL hold:
//   1. sandbox_id matches
//   2. observed_at >= grant.effective_from
//   3. grant.effective_to IS NULL OR observed_at <= grant.effective_to
//   4. the observation's capability is within the grant's capability scope
//
// Overlapping grants are expected, not an error: this function is a pure
// predicate over one (observation, grant) pair, and the caller attributes an
// observation to every grant that returns true, never to a single "best"
// match.

import { capabilityContains } from "./capability.js";
import type { BoundaryGrant, RawObservation } from "./types.js";

export function attributesTo(obs: RawObservation, grant: BoundaryGrant): boolean {
  if (obs.sandboxId !== grant.sandboxId) return false;

  const observedAtMs = Date.parse(obs.observedAt);
  const fromMs = Date.parse(grant.effectiveFrom);
  if (observedAtMs < fromMs) return false;

  if (grant.effectiveTo !== null) {
    const toMs = Date.parse(grant.effectiveTo);
    if (observedAtMs > toMs) return false;
  }

  return capabilityContains(grant.capability, obs.capability);
}
