-- Prompt 06: consequence linkage and incident review.
--
-- boundary_grant is the one mutable table in scout_governance - it is
-- explicitly a lifecycle record (open -> closed), not a log. effective_to
-- and closed_reason are set by real events (sandbox end, policy
-- supersession, explicit revoke), never by a cleanup sweeper.
--
-- grant_observation and incident_review_note stay append-only, like
-- boundary_decision in 0002.

CREATE TABLE IF NOT EXISTS scout_governance.boundary_grant (
    id                  BIGSERIAL PRIMARY KEY,
    decision_uid        UUID        NOT NULL,        -- the allow decision that created it
    tenant_id           TEXT        NOT NULL,
    sandbox_id          TEXT        NOT NULL,
    capability          TEXT        NOT NULL,        -- rpc or destination/host scope
    policy_digest       TEXT        NOT NULL,
    effective_from      TIMESTAMPTZ NOT NULL,
    effective_to        TIMESTAMPTZ,
    closed_reason       TEXT,                        -- 'sandbox_ended' | 'policy_superseded' | 'revoked'
    CONSTRAINT grant_window_valid CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS boundary_grant_sandbox_idx ON scout_governance.boundary_grant (sandbox_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS boundary_grant_decision_uid_idx ON scout_governance.boundary_grant (decision_uid);
CREATE INDEX IF NOT EXISTS boundary_grant_open_by_digest_idx ON scout_governance.boundary_grant (policy_digest) WHERE effective_to IS NULL;

-- Observations attributable to a grant. Deliberately generic in source, strict in shape.
CREATE TABLE IF NOT EXISTS scout_governance.grant_observation (
    id                  BIGSERIAL PRIMARY KEY,
    grant_id            BIGINT      NOT NULL REFERENCES scout_governance.boundary_grant(id),
    observed_at         TIMESTAMPTZ NOT NULL,
    kind                TEXT        NOT NULL,        -- 'outbound_call' | 'data_egress' | 'credential_use' | 'policy_change'
    destination_host    TEXT,                        -- host only, never a full URL with query
    outcome             TEXT        NOT NULL,        -- 'succeeded' | 'denied' | 'errored'
    byte_count          BIGINT,
    detail              JSONB,                       -- structured, and subject to the same privacy test
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS grant_observation_grant_idx ON scout_governance.grant_observation (grant_id, observed_at);
-- Not in the prompt's own index list, but required to make the inverse
-- query (host + window -> grants) an indexed lookup rather than an
-- application-side filter over every observation.
CREATE INDEX IF NOT EXISTS grant_observation_host_idx ON scout_governance.grant_observation (destination_host, observed_at);

-- Analyst annotation. Append-only, like everything else here.
CREATE TABLE IF NOT EXISTS scout_governance.incident_review_note (
    id                  BIGSERIAL PRIMARY KEY,
    decision_uid        UUID,
    grant_id            BIGINT,
    author              TEXT        NOT NULL,
    note                TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
