-- Prompt 05: the evidence store. Append-only - no UPDATE, no DELETE path
-- exists anywhere in the codebase against these tables; corrections are new
-- rows that supersede, never edits. Written off the decision path by
-- src/evidence/writer.ts's drain loop, never synchronously during Evaluate.

CREATE SCHEMA IF NOT EXISTS scout_governance;

CREATE TABLE IF NOT EXISTS scout_governance.boundary_decision (
    id                  BIGSERIAL PRIMARY KEY,
    decision_uid        UUID        NOT NULL DEFAULT gen_random_uuid(),
    correlation_id      TEXT,                       -- the gateway's correlation id when supplied
    occurred_at         TIMESTAMPTZ NOT NULL,
    layer               TEXT        NOT NULL,       -- 'control' | 'data'
    rpc                 TEXT        NOT NULL,       -- e.g. 'openshell.v1.OpenShell/CreateSandbox'
    phase               TEXT,                       -- control plane only
    tenant_id           TEXT        NOT NULL,
    workspace_id        TEXT,
    sandbox_id          TEXT,
    subject_label       TEXT,                       -- human-readable agent/sandbox label, never an email
    verdict             TEXT        NOT NULL CHECK (verdict IN ('allow','deny')),
    rule_id             TEXT,
    reason              TEXT        NOT NULL,       -- one line, no payload content
    policy_slug         TEXT        NOT NULL,
    policy_version      INTEGER     NOT NULL,
    policy_digest       TEXT        NOT NULL,       -- the value the verdict cites
    authority_kind      TEXT        NOT NULL,       -- 'owner' | 'signed_policy' | 'delegated' | 'default'
    authority_ref       TEXT,                       -- signature subject, owner id, delegation id
    residual_risk       TEXT,                       -- what the allowance still permits
    latency_us          INTEGER,
    evaluation_mode     TEXT        NOT NULL,       -- 'cached_snapshot' | 'fail_closed_default'
    service_version     TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boundary_decision_tenant_occurred_idx
    ON scout_governance.boundary_decision (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS boundary_decision_correlation_idx
    ON scout_governance.boundary_decision (correlation_id);
CREATE INDEX IF NOT EXISTS boundary_decision_sandbox_occurred_idx
    ON scout_governance.boundary_decision (sandbox_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS boundary_decision_policy_digest_idx
    ON scout_governance.boundary_decision (policy_digest);

-- The chain of custody for a policy document itself.
CREATE TABLE IF NOT EXISTS scout_governance.policy_provenance (
    id                  BIGSERIAL PRIMARY KEY,
    policy_id           BIGINT      NOT NULL,
    policy_digest       TEXT        NOT NULL,
    event               TEXT        NOT NULL,       -- 'authored' | 'signed' | 'activated' | 'superseded' | 'revoked'
    actor               TEXT        NOT NULL,
    actor_kind          TEXT        NOT NULL,       -- 'human' | 'agent' | 'system'
    signature_subject   TEXT,
    note                TEXT,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_provenance_digest_occurred_idx
    ON scout_governance.policy_provenance (policy_digest, occurred_at);

-- Decisions that could not be persisted. Never silently dropped.
CREATE TABLE IF NOT EXISTS scout_governance.decision_write_failure (
    id                  BIGSERIAL PRIMARY KEY,
    decision_uid        UUID,
    payload             JSONB       NOT NULL,
    error               TEXT        NOT NULL,
    attempts            INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
