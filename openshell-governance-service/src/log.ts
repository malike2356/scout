// Structured, stdout-only logging shared by the protocol handlers and the
// entrypoint. No secret value, match text, source content, environment
// content, absolute workstation path, or Git author email is ever logged -
// only fixed event names and request-shape metadata the protocol itself
// classifies as non-secret (binding ids, RPC method names).
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}
