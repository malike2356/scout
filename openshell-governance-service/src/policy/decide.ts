// The decision function. One pure function, no I/O, no clock reads beyond
// what the caller passes - deterministic and therefore testable without a
// database or a live gateway.

import { authorityOf, DEFAULT_AUTHORITY } from "./authority.js";
import { pointerGet } from "./json-pointer.js";
import { resolveBinding } from "./resolve-binding.js";
import type {
  BoundaryDecision,
  BoundaryRequest,
  JsonPatchOp,
  LoadedPolicy,
  PolicyPatchRule,
  PolicyRule,
  PolicySnapshot,
} from "./types.js";

function shortRpcName(rpc: string): string {
  const idx = rpc.lastIndexOf("/");
  return idx === -1 ? rpc : rpc.slice(idx + 1);
}

function matchesWhen(operation: Record<string, unknown>, rule: PolicyRule): boolean {
  const actual = pointerGet(operation, rule.when.path);
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

function findMatchingRule(
  policy: LoadedPolicy,
  method: string,
  operation: Record<string, unknown>,
): PolicyRule | undefined {
  return policy.document.rules.find(
    (rule) => (rule.rpc === "*" || rule.rpc === method) && matchesWhen(operation, rule),
  );
}

/**
 * Builds a safe JSON Patch for one policy patch rule. When the immediate
 * parent object of `path` does not yet exist in `operation`, patches the
 * parent into existence instead of the leaf - the same one-level fallback
 * `governance-interceptor`'s own `patch_create_sandbox` uses for `/spec`.
 */
function buildPatch(operation: Record<string, unknown>, rule: PolicyPatchRule): JsonPatchOp {
  const lastSlash = rule.path.lastIndexOf("/");
  const parentPath = lastSlash <= 0 ? "" : rule.path.slice(0, lastSlash);
  const leafKey = rule.path.slice(lastSlash + 1).replace(/~1/g, "/").replace(/~0/g, "~");
  const parent = parentPath === "" ? operation : pointerGet(operation, parentPath);
  if (parent !== null && typeof parent === "object" && !Array.isArray(parent)) {
    return { op: rule.op, path: rule.path, value: rule.value };
  }
  return { op: "add", path: parentPath, value: { [leafKey]: rule.value } };
}

function patchesFor(
  policy: LoadedPolicy,
  method: string,
  operation: Record<string, unknown>,
): JsonPatchOp[] {
  return policy.document.patches
    .filter((p) => p.rpc === "*" || p.rpc === method)
    .map((p) => buildPatch(operation, p));
}

export function decide(req: BoundaryRequest, snapshot: PolicySnapshot): BoundaryDecision {
  const method = shortRpcName(req.rpc);
  const binding = resolveBinding(snapshot.bindings, req);

  if (!binding) {
    // No binding resolved at any level, including global. An empty policy
    // is not a safe default either way - this is explicit, not silent:
    // fail closed at validate/modify_operation, fail open (and flagged) at
    // post_commit, since the operation has already committed by then.
    if (req.phase === "post_commit") {
      return {
        verdict: "allow",
        policySlug: "none",
        policyDigest: "none",
        reason: "no policy binding resolved for this subject; post_commit fails open by construction",
        residualRisk: "no policy governs this subject; the operation already committed unconditionally",
        authorityKind: DEFAULT_AUTHORITY.kind,
      };
    }
    return {
      verdict: "deny",
      policySlug: "none",
      policyDigest: "none",
      reason: "no policy binding resolved for this subject; failing closed, not treating absence as allow",
      authorityKind: DEFAULT_AUTHORITY.kind,
    };
  }

  const policy = snapshot.policiesById.get(binding.policyId);
  if (!policy) {
    // The binding points at a policy id the snapshot does not have loaded.
    // Same reasoning as above: this is a configuration fault, not silent
    // permission - fail closed except at post_commit.
    if (req.phase === "post_commit") {
      return {
        verdict: "allow",
        policySlug: "unknown",
        policyDigest: "unknown",
        reason: `binding referenced policy id ${binding.policyId}, not present in the loaded snapshot; post_commit fails open`,
        residualRisk: "cited policy id is not loaded; the operation already committed unconditionally",
        authorityKind: DEFAULT_AUTHORITY.kind,
      };
    }
    return {
      verdict: "deny",
      policySlug: "unknown",
      policyDigest: "unknown",
      reason: `binding referenced policy id ${binding.policyId}, not present in the loaded snapshot; failing closed`,
      authorityKind: DEFAULT_AUTHORITY.kind,
    };
  }

  const authority = authorityOf(policy);

  if (req.phase === "post_commit") {
    // The mutation already happened. Returning deny here would be a lie;
    // record the match (if any) and allow unconditionally.
    const matched = findMatchingRule(policy, method, req.operation);
    return {
      verdict: "allow",
      policySlug: policy.policySlug,
      policyVersion: policy.version,
      policyDigest: policy.digestSha256,
      ruleId: matched?.id,
      reason: matched
        ? `post_commit record: rule '${matched.id}' matched`
        : "post_commit record: no rule matched, default allow already applied",
      residualRisk: "operation already committed; this record is retrospective only",
      authorityKind: authority.kind,
      authorityRef: authority.ref,
    };
  }

  const matched = findMatchingRule(policy, method, req.operation);
  if (matched) {
    const base: BoundaryDecision = {
      verdict: matched.verdict,
      policySlug: policy.policySlug,
      policyVersion: policy.version,
      policyDigest: policy.digestSha256,
      ruleId: matched.id,
      reason: matched.reason,
      authorityKind: authority.kind,
      authorityRef: authority.ref,
    };
    if (matched.verdict === "deny") return base;
    const withRisk: BoundaryDecision = {
      ...base,
      residualRisk: `rule '${matched.id}' allowed this; no restriction beyond policy ${policy.policySlug} v${policy.version} applies`,
    };
    if (req.phase === "modify_operation") {
      return { ...withRisk, patches: patchesFor(policy, method, req.operation) };
    }
    return withRisk;
  }

  const base: BoundaryDecision = {
    verdict: policy.document.defaultVerdict,
    policySlug: policy.policySlug,
    policyVersion: policy.version,
    policyDigest: policy.digestSha256,
    reason: `no rule matched '${method}'; default verdict '${policy.document.defaultVerdict}' from policy ${policy.policySlug} v${policy.version}`,
    authorityKind: authority.kind,
    authorityRef: authority.ref,
  };
  if (base.verdict === "deny") return base;
  const withRisk: BoundaryDecision = {
    ...base,
    residualRisk: `default verdict of policy ${policy.policySlug} v${policy.version} allowed this; no rule constrained it further`,
  };
  if (req.phase === "modify_operation") {
    return { ...withRisk, patches: patchesFor(policy, method, req.operation) };
  }
  return withRisk;
}
