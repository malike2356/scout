// Canonical JSON for policy digests: recursively sorted object keys, stable
// array order. Both the seed/bootstrap tooling and the app must use this
// exact function so a digest computed once and a digest recomputed later
// from the same document always agree.

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJsonStringify(document: unknown): string {
  return JSON.stringify(sortValue(document));
}
