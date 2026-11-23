# Supersession map - 2026-10-24

Produced by `pending-prompts/openshell-governance/00-decommission-and-supersession-map.md`.
Read-only against Carina and against the standalone scout repo; no file moved, deleted, or
rewritten by this prompt. `git status --porcelain` in `scout` was clean before this prompt
ran and contains only this new file afterward.

Every module below was classified by reading its actual source (file paths cited inline), not by
name. The owner's instruction this responds to: **"we will be decommissioning the current Carina
and Scout and build a new Scout based on the OpenShell direction."**

## Verdict definitions (from the prompt)

| Verdict | Meaning |
|---|---|
| **Superseded** | The new OpenShell-based service's evidence store (05), consequence linkage (06), or OCSF emission (07) answers the same question, better, for an agent-agnostic boundary. Not ported. |
| **Complementary** | Answers a question the new service does not and cannot. Kept, decoupled from Carina. |
| **Obsolete** | Built for the Carina-coupled commercial SaaS framing; no PhD or governance value as live product code. Archived, not deleted. |

## The map

| Module/surface | Verdict | Reason | Action |
|---|---|---|---|
| `scout-engine` prompt filter (public `/v1` prompt-filter surface, agent-guard-gated) | Complementary | Governs prompt content before it reaches/returns from the model. OpenShell's `SupervisorMiddleware` evaluates request/response bytes with secret fields omitted at the transport layer; it has no view into whether prompt *content* is safe to send, only whether credentials are present. Different question, same layer depth. | Keep, in the standalone repo already. Decoupling from Carina is `keprix-engine-replacement` prompt 00's job, not this prompt's. |
| `scout-engine` event ingest (`src/event-server/api/events.ts`, `connected_agents` table) | Complementary | Generic runtime/tool-call telemetry independent of any sandbox boundary; the new evidence store (05) is specifically `scout_governance.boundary_decision`-shaped, not a general event log. | Keep. |
| `scout-engine` secret scanning (`src/secret-scanning/*`) | Complementary | Governs committed credentials in a repository, unrelated to sandbox boundaries or runtime request/response evaluation. | Keep as-is. |
| `scout-engine` kill switch (`src/control/instance-control.ts`, `src/api/public/v1/agent-guard.ts`) | Complementary | Agent-level suspension of a `connected_agents` row (HTTP 403 `kill_switch` on filter/events), not a sandbox-boundary allow/deny decision over a specific OpenShell RPC. | Keep. |
| `scout-engine` `src/api/boundary/{events,status}.ts` | **Naming collision, not a verdict subject** | Despite the name, this is agent/instance health plus a 24h security-event-count view over `carina_instances` - it is not a sandbox/gateway boundary decision in OpenShell's sense. Confirmed by reading both files directly. | Flag only: prompt 02 (extension service skeleton) must not reuse the bare word "boundary" for a new module name without disambiguating from this pre-existing, unrelated use, or a future reader will conflate the two. No code change here. |
| `console/audit/*` (`audit-logger.ts`, `audit-search.ts`, `audit-retention.ts`, `audit-schemas.ts`) | Superseded (mostly) | `scout_governance.boundary_decision` (prompt 05) is a stronger, append-only, tenant-scoped record for the layer this programme governs. Verified: `audit-logger.ts` is a thin normalizing writer into a Carina `tenant_id`-scoped `audit_log` table; `audit-retention.ts`'s own comment admits it deletes through an RLS append-only policy via a privileged bypass, which is weaker than a true append-only store. | Do not extract. Cite as prior art in the evidence-store design doc (prompt 05). |
| `console/governance/*` (`build-governance-posture.ts`, `framework-scorer.ts`, `regulatory-classification.ts`, `board-report-pdf.ts`, `load-regulatory-classification.ts`) | Obsolete | Verified by reading `build-governance-posture.ts`: it queries `carina_instances` and a hardcoded `'carina-reference'` trust identity, computes EU AI Act tier / UK DSIT alignment / SOC2 / GDPR / ISO42001 readiness via hand-weighted heuristic percentages (`framework-scorer.ts`: `eu*0.35 + gdpr*0.25 + soc2*0.20 + iso*0.20`, no citation or methodology beyond the weights themselves), and `board-report-pdf.ts` exists purely to hand-build a sellable PDF board report. This answers "is the whole AI system compliant," a broader and different question from "was this specific sandbox boundary decision correctly enforced." Deeply Carina-coupled at the data layer (not just gated UI), and the heuristic scoring has no citable research methodology to carry into a PhD write-up as-is. | Archive to `/home/malike/verlox/archive/`, do not port. The *idea* of a governance-posture view computed from real boundary-decision evidence may inform prompt 08's dashboard design, but the code itself is not reused. |
| `console/governance/industry-templates.ts` | Obsolete | Verified: four UK-sector templates (`uk-property`, `legal-uk`, `finance-uk`, `healthcare-uk`) each carrying a `base_pack` and `additional_blocked_tools` list - this is subscription-tier product differentiation by regulated vertical, not a governance mechanism. | Archive, same reasoning and destination as above. |
| `console/trust/*` (`erc8004-*`, `erc8126/*`, `critical-event-attestation.ts`, `create-trust-sdk.ts`, `attestation-adapter.ts`, `build-public-trust.ts`, `compute-trust-metrics.ts`, `trust-history.ts`, `risk-spike-monitor.ts`, `compliance-report.ts`) | **Complementary, but paper-artifact only - see Step 4 below** | | See Step 4. |
| `console/middleware/operator-auth.ts`, `console/middleware/auth.ts` | Complementary | Verified: generic Express middleware (API-key + optional TOTP + IP allowlist auth, `requireOperatorAuth`/`requireApiKey`). Zero Carina references in either file. A reusable pattern for whatever lightweight HTTP admin/health surface the new service exposes (prompt 08, prompt 12's mTLS work is separate and does not replace this for non-gRPC admin routes). | Extract into `console/` as part of `scout-carina-separation` prompt 04. |
| `console/middleware/provision-auth.ts` | Complementary | Generic shared-secret header check (`requireProvisionSecret`), 16 lines, no Carina coupling. | Extract (trivial; could also just be rewritten, but no reason not to copy it). |
| `console/middleware/account-session.ts`, `console/middleware/dashboard-session.ts` | Obsolete | Two separate, redundant session mechanisms for a customer self-service "account" area and a distinct "dashboard" login - a symptom of the SaaS signup/subscriber-tier split. The new service's own tenant/operator model is being defined fresh in prompts 08-09 and has no multi-tenant subscriber signup flow. | Archive, do not port. |
| `console/middleware/plan-gate.ts` | Obsolete | Verified: `requireScoutPro` checks a subscription plan and returns `{error: 'Scout Pro required', upgrade_url: '/checkout?plan=scout_pro'}` on a 403. Pure billing-tier gate, nothing else. | Archive, do not port. |
| `console/protect/board-pack.ts` | Obsolete | Verified: builds a 30-day MDR/board-level incident pack (sensor health, containment actions, policy denials, attestations) over Protect-specific Carina tables (`sensor_keys`, `protect_control_commands`), explicitly a sellable board-report artifact - the same pattern as `board-report-pdf.ts` above, for a different product line. The new evidence store/consequence-linkage work (05/06) does the same underlying job (decision-to-outcome linkage) for the layer this programme actually governs. | Archive, cite as prior art in the evidence-store design doc, same treatment as `console/audit`. |
| `console/protect/telemetry-schema.ts` | Obsolete (as a file); its pattern is cited as prior art | Verified: already enforces a `FORBIDDEN_KEYS` credential-omission contract (password/token/cookie/private_key/etc. rejected from any telemetry payload) at the application layer. Genuinely close in spirit to OpenShell's own transport-layer secret-omission guarantee (hard rule 7 of this programme), but it was built for the old Protect product's sensor telemetry and is not itself reused. | Archive the file; reference the `FORBIDDEN_KEYS` validation technique by name in prompt 04/05's data-plane-middleware design notes as confirmed prior art, nothing more. |
| `console/protect/protect-audit.ts` | Obsolete (as a file); its pattern is cited as prior art | Verified: writes a `security_events` row, then calls `attestCriticalSecurityEvent` (in `trust/critical-event-attestation.ts`) which implements a working **hash-chain** - `content_hash` over the canonical event, `chain_hash = sha256(previous_chain_hash + content_hash)`, HMAC signature over the chain hash, verified later by recomputing. This is a real, reusable tamper-evidence technique that needs no blockchain. | Archive the files; cite the content-hash -> chain-hash -> HMAC-signature technique explicitly as prior art for prompt 05's append-only evidence-store design. |
| `console/detections/rule-runner.ts` + `console/detections/README.md` + `console/detections/packs/` | Complementary | Verified: a small declarative JSON-rule engine (`runDetectionsOnEvent`) matching event payloads against `cmd_contains`/`remote_port`/`path_prefix`/`risk_tags` conditions. Zero database access, zero Carina references, zero billing coupling - pure logic. Answers "is this telemetry suspicious," a different question from "was this boundary request allowed," and is a candidate for a future detection layer over OCSF-emitted events (prompt 07). | Extract into `console/` as part of `scout-carina-separation` prompt 04. |

## Step 4 - the trust/attestation decision

`console/trust/*` is cryptographic attestation of an agent's own claimed actions (ERC-8004 on-chain
identity registration, ERC-8126 unified-risk-score verification, HMAC-chained critical-event
attestation) - not something OpenShell does, and not something the new boundary-decision model
replaces. It is a genuinely different research claim from "this specific gateway/supervisor
decision was correctly enforced": one proves an agent's claimed action matches what happened: the
other proves a boundary was correctly enforced on a specific RPC.

**Decision: these are treated as two separate claims, and `trust/*` is extracted into the paper's
artifact repo only (`scout-carina-separation` prompt 13), not into the live product tree
(`console/`).**

Reason, from direct reading of the code:

1. Every module in this directory is Carina-coupled at the *data* layer, not just gated behind a
   paywall: `create-trust-sdk.ts` and `register-erc8004.ts` hardcode a `'carina-reference'` slug and
   `https://core.carinaai.uk/.well-known/agent-card.json` as the default agent identity URI;
   `build-public-trust.ts` queries `carina_instances` directly. Porting this into `console/` as
   working code would silently reintroduce Carina into Scout, which this programme's sibling
   (`keprix-engine-replacement`) hard rule 10 explicitly forbids ("zero mentions of Carina anywhere
   in Scout except historical docs").
2. The on-chain write path (`register-erc8004.ts`) is gated on `TRUST_ATTESTER_PRIVATE_KEY` being
   set and returns `{ok: false, skipped: true}` when it is not - i.e. this is largely an
   unconfigured, unproven capability in this environment, not a running system. Hard rule 10 of this
   programme ("never claim customers, deployments, benchmarks, or production use") applies with
   equal force to claiming this is a live capability.
3. Treating attestation-of-claims and boundary-decision-correctness as one unified claim would be
   exactly the conflation the programme's own pitfall warning calls out, and would weaken rather than
   strengthen the paper.

Consequence for `/home/malike/papers/scout-openshell-decision-provenance/` (if and when that
directory is created): boundary-decision provenance and attestation provenance are documented as
**two separate claims with two separate evidence chains**, not one. The attestation modules are
preserved for that purpose by copy into the paper's artifact repo; they are not deleted, and they are
not live product code.

## Supplementary findings worth recording (not required by the template, found while reading)

- **Instance-identity fragmentation already exists inside the standalone repo, independent of
  Carina.** `scout-engine/src/control/instance-control.ts` and `scout-engine/src/api/boundary/
  status.ts` both read `carina_instances`, while `scout-engine/src/api/public/v1/agent-guard.ts`
  (the kill-switch guard actually used by the public `/v1` surface) reads a *different* table,
  `connected_agents`. Two tables for what should be one "which agent is this" concept, inside the
  one tree that is supposedly already Carina-decoupled. This is squarely `keprix-engine-replacement`
  prompt 00's scope ("purge Carina coupling and unify the instance model"), not this prompt's - flagged
  here so that programme's prompt 00 does not have to rediscover it from scratch.

## Step 3 - correcting the two programmes

- **`scout-carina-separation/04-extract-console-into-scout-repo.md` has been corrected** (this same
  session) to name the actual complementary set explicitly - `console/detections/*` and
  `console/middleware/{operator-auth,auth,provision-auth}.ts` only - replacing its prior guess, which
  assumed `trust/erc8004-*`/`trust/erc8126/*`/`audit/*` would be extracted as "paper-critical modules"
  into `console/`. That guess is superseded by this map: `trust/*` goes to the paper-artifact repo
  (prompt 13) only, and `audit/*` is not extracted at all (Superseded, cited as prior art).
- **This programme's prompt 08** (governance operator surface) should note, when it is built, that
  its `/governance/*` routes deliberately replace `console/governance`'s EU AI Act tiering /
  framework scoring rather than extend it, so a reviewer comparing the two understands the change is
  a scope narrowing, not a regression.

## Acceptance criteria check

- [x] Every module named in the original six-group list (`audit`, `governance`, `trust`,
      `middleware`, `protect`, `detections`), plus `scout-engine`'s four surfaces, has a verdict,
      reason, and action with no `?` left unfilled.
- [x] `scout-carina-separation/04-extract-console-into-scout-repo.md` edited to scope extraction to
      the Complementary set only, named explicitly.
- [x] The trust/attestation decision is recorded with its reason; the paper-directory relationship
      (two separate claims) follows from the reasoning, not the other way around.
- [x] No code deleted or moved by this prompt - decision doc only.
- [x] `git status --porcelain` in the scout repo: clean before, contains only this file and the
      `04-extract-console-into-scout-repo.md` edit after.
