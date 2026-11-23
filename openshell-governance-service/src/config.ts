// Env + file config for the Scout OpenShell governance extension service.
// Fails loudly (throws) on any missing required value - this process must
// not start half-configured, since a silently-wrong Describe response is
// exactly the failure mode prompt 02 exists to rule out.

export interface ServiceConfig {
  /** Absolute filesystem path for the GatewayInterceptor unix socket. */
  interceptorSocketPath: string;
  /** TCP port the SupervisorMiddleware + HttpResponsePreReturn TLS server binds. */
  middlewarePort: number;
  /** PEM certificate path for the middleware's TLS listener. */
  middlewareTlsCertPath: string;
  /** PEM private key path for the middleware's TLS listener. */
  middlewareTlsKeyPath: string;
  /** HTTP health port for the operator and break-glass diagnosis. */
  healthPort: number;
  /** Exact JWT audience this service verifies for the interceptor registration. */
  interceptorAudience: string;
  /** Exact JWT audience this service verifies for the middleware registration. */
  middlewareAudience: string;
  /** Payload ceiling for middleware bodies; Describe advertises this exact value. */
  middlewareMaxPayloadBytes: number;
  /** Postgres connection string holding scout_policy / scout_policy_binding. */
  policyDatabaseUrl: string;
  /** Milliseconds between automatic policy reload attempts. */
  policyReloadIntervalMs: number;
  /** Milliseconds between evidence-writer drain attempts (prompt 05). */
  evidenceDrainIntervalMs: number;
  /** Bounded in-process queue capacity before new decisions are dead-lettered. */
  evidenceQueueCapacity: number;
  /** Bounded in-process queue capacity for grant/observation writes (prompt 06). */
  linkageQueueCapacity: number;
  /** Human-readable implementation identity reported in Describe. */
  implementationName: string;
  /** Build/version string reported in Describe, diagnostics only. */
  implementationVersion: string;
  /**
   * Test-only: overrides the protocol major version Describe reports.
   * Exists solely to produce prompt 02's invalid-manifest fail-closed proof
   * (a conforming gateway must refuse to start when this disagrees with its
   * own protocol major). Never set outside that test.
   */
  debugProtocolMajorOverride: number | undefined;
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value.trim() === "") {
    throw new Error(`missing required config: ${name}`);
  }
  return value;
}

function requirePort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid config: ${name} must be a port between 1 and 65535`);
  }
  return port;
}

function requirePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid config: ${name} must be a positive integer`);
  }
  return value;
}

export function loadConfig(): ServiceConfig {
  return {
    interceptorSocketPath: requireEnv(
      "SCOUT_INTERCEPTOR_SOCKET_PATH",
      "/tmp/scout-governance-interceptor.sock",
    ),
    middlewarePort: requirePort("SCOUT_MIDDLEWARE_PORT", 18082),
    middlewareTlsCertPath: requireEnv("SCOUT_MIDDLEWARE_TLS_CERT_PATH"),
    middlewareTlsKeyPath: requireEnv("SCOUT_MIDDLEWARE_TLS_KEY_PATH"),
    healthPort: requirePort("SCOUT_HEALTH_PORT", 18080),
    interceptorAudience: requireEnv(
      "SCOUT_INTERCEPTOR_AUDIENCE",
      "urn:verlox:scout:governance",
    ),
    policyDatabaseUrl: requireEnv("SCOUT_POLICY_DATABASE_URL"),
    policyReloadIntervalMs: requirePositiveInt("SCOUT_POLICY_RELOAD_INTERVAL_MS", 30_000),
    evidenceDrainIntervalMs: requirePositiveInt("SCOUT_EVIDENCE_DRAIN_INTERVAL_MS", 2_000),
    evidenceQueueCapacity: requirePositiveInt("SCOUT_EVIDENCE_QUEUE_CAPACITY", 10_000),
    linkageQueueCapacity: requirePositiveInt("SCOUT_LINKAGE_QUEUE_CAPACITY", 10_000),
    middlewareAudience: requireEnv(
      "SCOUT_MIDDLEWARE_AUDIENCE",
      "urn:openshell:extension:middleware:scout-governance",
    ),
    implementationName: requireEnv(
      "SCOUT_IMPLEMENTATION_NAME",
      "verlox/scout-openshell-governance",
    ),
    implementationVersion: requireEnv("SCOUT_IMPLEMENTATION_VERSION", "0.1.0-skeleton"),
    middlewareMaxPayloadBytes: requirePositiveInt("SCOUT_MIDDLEWARE_MAX_PAYLOAD_BYTES", 262_144),
    debugProtocolMajorOverride: process.env.SCOUT_DEBUG_PROTOCOL_MAJOR_OVERRIDE
      ? Number.parseInt(process.env.SCOUT_DEBUG_PROTOCOL_MAJOR_OVERRIDE, 10)
      : undefined,
  };
}
