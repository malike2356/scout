# Scout OpenShell governance extension service

Prompts 02-06 and 08 of `pending-prompts/openshell-governance/`: a running
TypeScript gRPC service OpenShell accepts as an extension, answering
`Describe` for both the `GatewayInterceptor` and `SupervisorMiddleware`
contracts, answering `Evaluate` for the `GatewayInterceptor` contract with
a real, versioned, digest-cited policy decision over the control-plane
RPCs (sandbox creation, provider attachment, access-surface changes,
credential rotation, policy edits), answering request/response/websocket
evaluation for the data plane with the same policy engine (prompt 04),
recording every one of those decisions as an append-only, asynchronously
written Postgres evidence record with its own provenance chain (prompt 05),
linking a boundary decision to what the agent did under it - the grant it
opened, the hosts it reached, the incident queries an operator actually
asks (prompt 06) - and surfacing all of it behind the existing
`scout-dashboard` login as a real operator UI (prompt 08).

## Run it

```bash
npm install
npm run gen     # buf generate from the vendored proto (../_vendor/OpenShell/proto)
npm run build

# Postgres holding scout_policy / scout_policy_binding (see sql/0001_scout_policy.sql)
docker run -d --name scout-governance-postgres \
  -e POSTGRES_USER=scout -e POSTGRES_PASSWORD=scout-governance-dev-only -e POSTGRES_DB=scout_governance \
  -p 127.0.0.1:54320:5432 postgres:16-alpine
cat sql/0001_scout_policy.sql | docker exec -i scout-governance-postgres psql -U scout -d scout_governance
cat sql/0002_scout_governance_evidence.sql | docker exec -i scout-governance-postgres psql -U scout -d scout_governance
cat sql/0003_scout_governance_linkage.sql | docker exec -i scout-governance-postgres psql -U scout -d scout_governance
SCOUT_POLICY_DATABASE_URL="postgres://scout:scout-governance-dev-only@127.0.0.1:54320/scout_governance" \
  node dist/scripts/seed-baseline-policy.js

SCOUT_MIDDLEWARE_TLS_CERT_PATH=/path/to/cert.pem \
SCOUT_MIDDLEWARE_TLS_KEY_PATH=/path/to/key.pem \
SCOUT_POLICY_DATABASE_URL="postgres://scout:scout-governance-dev-only@127.0.0.1:54320/scout_governance" \
npm start
```

`scout-governance-postgres` above is a throwaway local dev container, not a
deployment target - a real deployment points `SCOUT_POLICY_DATABASE_URL` at
an operator-managed Postgres, applies `sql/0001_scout_policy.sql` once, and
manages policy rows/bindings through real tooling rather than the seed
script (which exists for dev/test only).

Four listeners start:

| Surface | Default | Purpose |
|---|---|---|
| GatewayInterceptor | Unix socket `/tmp/scout-governance-interceptor.sock` | `Describe`, `Evaluate` (real policy decisions) |
| SupervisorMiddleware + HttpResponsePreReturn | TCP `18082`, TLS | `Describe`, `ValidateConfig`, real request/response/websocket policy evaluation (prompt 04) |
| Operator HTTP | HTTP `18080` | `GET /health`, `GET /policy/status`, `POST /policy/reload`, `GET /evidence/*` (prompt 05), `GET`/`POST /linkage/*` (prompt 06) |

See `src/config.ts` for every `SCOUT_*` environment variable and its default,
including `SCOUT_EVIDENCE_DRAIN_INTERVAL_MS` (default 2000) and
`SCOUT_EVIDENCE_QUEUE_CAPACITY` (default 10,000), both added for prompt 05,
and `SCOUT_LINKAGE_QUEUE_CAPACITY` (default 10,000, added for prompt 06 -
the linkage writer shares prompt 05's drain timer rather than its own).

The interceptor uses a plaintext Unix socket rather than TLS: `unix://`
transport needs no certificate because the gateway authenticates over it
with a minted bearer token instead (confirmed against
`openshell-extension-core`'s `transport.rs` - only interceptors support this,
middleware must use `https://` since sandbox supervisors, not only the
gateway, need to reach it).

## The policy engine (prompt 03)

- `src/policy/decide.ts` - the pure decision function. No I/O, no clock reads
  beyond what the caller passes. Resolves a binding (`resolve-binding.ts`,
  most specific wins: workspace > tenant > policy > global), finds the first
  matching rule for the RPC, and returns an `allow`/`deny` verdict citing the
  policy's `digest_sha256`, never `version` alone.
- `src/policy/snapshot.ts` - loads `scout_policy` / `scout_policy_binding`
  into an immutable, atomically-swapped in-memory snapshot. `decide.ts`
  never imports the database module (`src/policy/db.ts`) - that is what
  makes "zero database round trips during evaluation" a structural fact,
  proven by `test/latency.test.ts`'s instrumented-pool query counter, not
  merely claimed.
- Reload: a timer (`SCOUT_POLICY_RELOAD_INTERVAL_MS`, default 30s) and
  `SIGHUP` both call `reload()`. A failed reload keeps the previous
  snapshot, logs `policy_reload_failed`, and surfaces on `GET
  /policy/status` - it never adopts an empty or partial snapshot.
- Phases: `modify_operation` and `validate` fail closed (a deny stops the
  operation); `post_commit` always returns allow and records which rule
  matched, since the operation has already committed by then - returning
  deny there would be a lie, not a safety measure. This interceptor does not
  bind `post_commit` at all yet (see prompts 05/06, evidence store and
  consequence linkage); only `modify_operation`/`validate` are registered.
- Deliberately does **not** reimplement signed-policy enforcement,
  proposal-approval blocking, or provider-profile governance - NVIDIA's own
  `governance-interceptor` reference example already demonstrates those
  (prompt 01). Scout's registration governs a different, non-overlapping RPC
  set: see `VALIDATE_ONLY_RPCS` in `src/protocol/describe-interceptor.ts`.

## The evidence store (prompt 05)

- `sql/0002_scout_governance_evidence.sql` - `scout_governance.boundary_decision`
  (append-only, no `UPDATE`/`DELETE` path anywhere in the codebase - enforced
  by a static grep test, not reviewer discipline), `scout_governance.policy_provenance`
  (the chain of custody for a policy document itself), and
  `scout_governance.decision_write_failure` (a failed or dropped write, never
  silently lost).
- `src/evidence/writer.ts` - `record()` is non-blocking and performs zero I/O;
  it appends to an in-process bounded queue and refuses (counted, not
  swallowed) a record missing `authorityKind` or `reason`. A timer-driven
  `drainOnce()` batches inserts to Postgres off the decision path, routes any
  insert failure to `decision_write_failure` row-by-row, and lazily
  self-heals `policy_provenance` for any policy digest it has not seen yet.
  The writer uses its own, uninstrumented `pg.Pool` - kept deliberately
  separate from the policy snapshot's instrumented pool - so its background
  queries never show up in prompt 03's "zero database round trips during
  `Evaluate`" count.
- `src/policy/authority.ts` - derives `authorityKind`/`authorityRef` from a
  loaded policy (`signed_policy` when the policy carries a signature, `owner`
  otherwise); every `decide.ts`/middleware verdict now also carries a
  `residualRisk` string on allow, since an allow with no stated residual risk
  is exactly the gap prompt 05 exists to close.
- `src/evidence/http.ts` - `GET /evidence/decisions` (filtered, paged),
  `GET /evidence/decisions/:uid` (one decision plus its full provenance
  chain), `GET /evidence/policies` (every digest's full
  authored/signed-activated-superseded chain, grouped - added for prompt
  08's policy provenance page; a plain cross-schema join to `scout_policy`
  for the slug/version, same Postgres connection), `GET /evidence/health`
  (queue depth, drain lag, dead-letter count, write-failure count),
  `GET /evidence/export` (NDJSON stream for an auditor), all mounted on the
  existing operator HTTP listener.
- `EvidenceWriter.recordSupersession()` - the 'superseded' provenance event
  prompt 05 defined in its schema but never actually wrote anywhere. Called
  from the same reload path that closes superseded grants (prompt 06), so
  both records of "this digest stopped being active" are written from one
  trigger.
- Proven by `test/evidence-writer.test.ts` (7 tests against the real dev
  Postgres: zero writes during `record()`, refusal-not-silent-drop,
  full-queue dead-lettering, a privacy test driving a real sentinel bearer
  token through `evaluateHttpRequest()` and scanning every evidence table for
  it afterwards, 1,000 decisions over a sustained drain with zero losses and
  reported drain lag, provenance auto-recording, and the static
  no-`UPDATE`/`DELETE` grep) and `test/evidence-http.test.ts` (one live
  end-to-end test: a real gRPC decision through the compiled service, read
  back through every `/evidence/*` route).

## Consequence linkage (prompt 06)

The question an incident review actually asks: given a boundary decision
that allowed something, what did the agent do under it, and the inverse -
given a host that was contacted, which decision let it happen.

- `sql/0003_scout_governance_linkage.sql` - `scout_governance.boundary_grant`
  (the one *mutable* table in this product - closing a grant is a real
  `UPDATE` of `effective_to`/`closed_reason`, never a new row, because "is
  this boundary currently in force" has one current answer; opening one is
  still an `INSERT`, never edited after), `scout_governance.grant_observation`
  (append-only; host only, never a full URL), `scout_governance.incident_review_note`.
- `src/linkage/attribute.ts` - the one attribution rule ("which observations
  belong to which grant"), implemented once: sandbox id matches, the
  observation falls inside `[effective_from, effective_to]`, and the
  observation's capability is within the grant's capability scope
  (`src/linkage/capability.ts` - `"*"` grants everything in the sandbox; a
  scope like `service:web` also covers `service:web:port:8080`, never a
  sibling or a broader scope). Overlapping grants both attribute - this
  function returns a match per grant, and the caller never picks "the
  best one".
- `src/linkage/writer.ts` - `LinkageWriter`, same non-blocking-`record()` /
  timer-driven-`drainOnce()` discipline as `EvidenceWriter`. `openGrant()`
  refuses (counted) a grant with no resolvable sandbox id rather than
  opening one keyed on the wrong identity; `recordObservation()` attributes
  against the grants open *at drain time* and inserts one row per matching
  grant, counting (never fabricating a row for) an observation that matches
  none.
- **A real constraint found against the live gateway, not assumed**: the
  gateway refuses a manifest declaring two separate bindings for the same
  RPC. Opening a grant correctly needs the gateway's real sandbox id, which
  only exists in `POST_COMMIT`'s committed response (the request side of
  `AttachSandboxProvider`/`ExposeService`/`DeleteSandbox` names a sandbox by
  its human-reusable *name*, not the stable id the data plane's
  `RequestContext.sandbox_id` uses - see the comment above
  `GRANT_LIFECYCLE_RPCS` in `src/protocol/describe-interceptor.ts`). Since
  `POST_COMMIT` cannot be a second binding, it has to join the existing
  `VALIDATE` binding for `CreateSandbox`, `AttachSandboxProvider`,
  `ExposeService`, and `DeleteSandbox` - and the proto's own rule then forces
  that *whole* binding to `fail_open`. That is a real, narrow cost: for
  exactly these four RPCs, Scout being unreachable now fails open, not just
  at `post_commit`. The other ten RPCs in `VALIDATE_ONLY_RPCS` keep the
  fail-closed guarantee prompt 03 proved, untouched.
- `src/linkage/http.ts` - `GET /linkage/decisions/:uid/activity` (forward:
  the grant(s) a decision opened, plus every observation under them),
  `GET /linkage/grants` (filter `open=true`, `tenant`, `sandboxId`; paged),
  `GET /linkage/grants/:id`, `POST /linkage/grants/:id/revoke` (prompt 08's
  emergency lever - see below), `POST /linkage/inverse` (body: `host`,
  `from`, `to`, optional `tenant` - an indexed query against
  `grant_observation(destination_host, observed_at)`, never an
  application-side scan), `GET /linkage/gaps` (decisions that should have
  opened a grant but didn't; grants with zero observations - both are
  findings, not bugs to hide), `GET /linkage/health`.
- `LinkageWriter.revokeGrant()` is the one operation in this module that is
  deliberately **not** queued through `record()`/`drainOnce()`: an operator
  pressing revoke needs a real yes/no before the UI can report success, not
  "queued, maybe eventually". It is also deliberately honest about its own
  limit - this service has no gateway administrative client, so revoking
  closes Scout's own grant record and writes the audit note for real, but
  does not (cannot, today) also detach the underlying capability live at
  the platform. The response always carries
  `liveCapabilityDetachAttempted: false` so no caller can read a closed
  grant as "the platform permission is gone".
- Proven by `test/attribute.test.ts` (14 fast, synchronous tests: the
  window boundaries exactly at and one millisecond either side of
  `effective_from`/`effective_to`, overlapping grants both attributing, and
  the capability-scope rule including the "shares a string prefix but not a
  scope boundary" trap), `test/superseded-digests.test.ts` (4 tests for the
  pure "which digests did a reload just supersede" function),
  `test/linkage-writer.test.ts` (5 tests against the real dev Postgres:
  refusal on an unresolved sandbox id, policy-supersession closing within
  one drain cycle, an unattributed observation counted and never inserted,
  one observation landing once per overlapping grant, and the privacy test
  extended to `grant_observation.detail`), and `test/linkage-live.test.ts`
  (one live end-to-end test: a real `GatewayInterceptor.Evaluate` call over
  the same unix socket a real gateway would use, for a `post_commit`
  `CreateSandbox` - opens a real grant; a real `EvaluateHttpRequest` - the
  observation attributes to it; `/linkage/grants` (list), `/linkage/grants/:id`,
  `/linkage/inverse`, and `/linkage/gaps` all checked against what the
  forward query already showed; a second grant is opened and revoked via
  `/linkage/grants/:id/revoke`, asserting a definite success on the first
  call and an honest 409 on a second revoke of the same grant; a `post_commit`
  `DeleteSandbox` closes the first grant).

## Registering it with a gateway

See `deploy/gateway.toml.template` - every field there was exercised against
a real local gateway build in this session, not guessed from the README.

## What's proven here, with real evidence, not just read from source

Ran in-session against the vendored OpenShell clone's real `openshell-gateway`
binary (`_vendor/OpenShell/target/debug/openshell-gateway`):

**Prompt 02 (registration/handshake):**
- The gateway reaches a ready state with Scout registered on both contracts,
  `Describe` captured on both sides.
- **Fail-closed**: with Scout not running, the gateway refuses to start.
- **Invalid manifest**: `Describe` reporting protocol `2.0` (via the
  test-only `SCOUT_DEBUG_PROTOCOL_MAJOR_OVERRIDE` env var) refuses to start.
- **Audience mismatch**: a registration `audience` that disagrees with
  `Describe`'s `expected_audience` refuses to start.

**Prompt 03 (the decision function), against a live gateway + Postgres, not simulated:**
- `openshell sandbox create --label scout-forbidden=true ...` was refused:
  `label scout-forbidden=true is blocked by policy baseline-sandbox v1` -
  the gateway's own log shows `decision="deny"` citing the real policy
  digest and `rule_id="deny-forbidden-label"`.
- `openshell sandbox create ...` (no forbidden label) was allowed, and the
  resulting sandbox's persisted `labels` include `"scout-governed": "true"` -
  a field the CLI command never requested, injected by the
  `modify_operation` patch and visible in `sandbox get ... -o json`.
- `GET /policy/status` and `POST /policy/reload` both exercised live against
  the running service with a real Postgres-backed snapshot swap.

`test/registration.test.ts` and the manual gateway run above both spawn the
real gateway binary - neither is a mock. `test/decide.test.ts` covers the
decision function and binding precedence (including a dedicated test that
each specificity level - workspace, tenant, policy, global - wins over the
level below it) as fast, synthetic-snapshot unit tests. `test/latency.test.ts`
asserts p99 < 25ms and zero database queries over 10,000/1,000 decisions
respectively. `test/describe.test.ts` covers the manifest shapes.

**Prompt 04 (data-plane middleware) and 05 (evidence store), against the
same live gateway and Postgres:** `test/middleware-evaluate.test.ts` and
`test/middleware-live.test.ts` drive real
`EvaluateHttpRequest`/`EvaluateWebSocketSession`/`HttpResponsePreReturn`
calls through the policy engine and assert a credential header or an
over-ceiling body is denied without ever appearing in the denial reason;
`test/evidence-writer.test.ts` and `test/evidence-http.test.ts` are detailed
above. Run the full suite with `npm test` after `npm run build` (the
registration and evidence-http tests need the vendored gateway binary built
and a reachable dev Postgres respectively; `SCOUT_TEST_POLICY_DATABASE_URL`
overrides the default local test Postgres connection string). Last full run:
41 passed, 1 skipped (a documented, unresolved OpenShell-internal relay hang
after a data-plane allow - see `test/credential-invisibility.test.ts`'s
header comment), 0 failed.

## The governance operator surface (prompt 08)

This service's own operator HTTP port (`/evidence/*`, `/linkage/*`) is
deliberately unauthenticated - it is meant to be reached from inside a
deployment, not from a browser. Rather than add auth here, the operator
surface lives behind the *existing* `scout-dashboard` login:

- `scout-engine/src/api/dashboard/governance.ts` - a thin, JWT-authenticated
  proxy router (`/api/dashboard/governance/*`), mounted alongside
  `scout-engine`'s other dashboard routes, forwarding to
  `SCOUT_GOVERNANCE_API_URL` (default `http://localhost:18080`). Revoke's
  `author` is always the authenticated caller's own session identity, never
  a client-supplied field. Known, stated limitation: the governance service
  has no multi-tenant model yet (prompt 09), so every dashboard
  organization that reaches these routes currently sees the same
  governance data.
- `scout-dashboard/src/app/dashboard/governance/` - five routes
  (`/dashboard/governance` overview, `.../decisions`, `.../decisions/[uid]`,
  `.../policies`, `.../grants`, `.../incidents`), reusing the dashboard's
  existing component library, auth, and recharts (not ApexCharts - the
  prompt's own "stack to match" text assumed a library this codebase does
  not actually use; the real one already here is recharts, and the prompt's
  own pitfall against adding a second charting library settled which to
  follow).
- The four "never" rules are structural, not just reviewed: the governance
  API types (`src/lib/types.ts`) carry no email field and no raw `url`
  field anywhere, only `destination_host`; `ResidualRisk` renders a visible
  warning rather than nothing when an allow is missing one; revoke
  (`RevokeGrantDialog`) requires typing the sandbox id, writes an audit
  note, and is not optimistic - the grants list only updates after a real
  200 response, and a definite failure (wrong id, already closed,
  unreachable gateway) surfaces as an error, never a silent success.
- Verified live, not just built: a real end-to-end run (real governance
  service, real `scout-engine` proxy, real Postgres, a real signed-up
  dashboard user, a real browser via Playwright) drove every route against
  real seeded decisions/grants/observations, including the full typed-
  confirmation revoke flow (wrong confirmation text correctly keeps the
  button disabled; the correct text closes the grant and the list
  reflects it; revoking the same grant twice fails honestly rather than
  reporting a phantom second success) and the governance-service-down
  case (the dashboard shows "Could not reach the governance service." with
  a retry, not stale or fabricated data).
- `src/components/governance/dom-safety.test.ts` - checks the "no email, no
  URL with a query string" rule structurally (the types have no such
  fields to begin with) rather than via a rendered-markup snapshot; this
  codebase's `tsconfig.json` uses `"jsx": "preserve"` for Next.js's own
  compiler, which the plain `tsx --test` runner cannot transform on its
  own, and there is no existing component-render test harness here to
  build one against for two small presentational components.

## What this is not

No OCSF emission (prompt 07), no multi-tenant isolation (prompt 09). The `tenantId` used in binding
resolution and in every evidence row is a fixed placeholder (`"default"`) -
real multi-tenant subject derivation is prompt 09's job. No deployment,
customers, or production use - this is a personal research project, not a
shipped product; nothing here should be read as a claim otherwise.
