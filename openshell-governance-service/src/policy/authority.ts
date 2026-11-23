// Shared by both planes (decide.ts and middleware/evaluate.ts) so a
// control-plane and a data-plane decision citing the same policy always
// agree on who/what authorized it.

import type { AuthorityKind, LoadedPolicy } from "./types.js";

export function authorityOf(policy: LoadedPolicy): { kind: AuthorityKind; ref?: string } {
  if (policy.signature) {
    return { kind: "signed_policy", ref: policy.signedBy };
  }
  return { kind: "owner", ref: policy.policySlug };
}

export const DEFAULT_AUTHORITY: { kind: AuthorityKind; ref?: string } = { kind: "default" };
