// One canonical capability-scope rule, used by attribute.ts and nowhere
// re-derived. A grant's capability is a colon-delimited scope path; "*"
// grants everything inside that sandbox. A narrower grant (e.g.
// "service:web") contains an observation's capability only when the
// observation's capability equals it or is a child of it
// ("service:web:port:8080"). This is the one implementation the prompt's
// own pitfall text demands - every query reuses it rather than re-deriving
// its own notion of "within scope".
export function capabilityContains(grantCapability: string, observationCapability: string): boolean {
  if (grantCapability === "*") return true;
  if (observationCapability === grantCapability) return true;
  return observationCapability.startsWith(`${grantCapability}:`);
}
