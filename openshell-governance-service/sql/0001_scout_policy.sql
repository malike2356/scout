-- Loaded into memory at startup and on reload. Read rarely, evaluated often -
-- src/policy/snapshot.ts is the only code path that queries this table.
CREATE TABLE IF NOT EXISTS scout_policy (
    id              BIGSERIAL PRIMARY KEY,
    policy_slug     TEXT        NOT NULL,          -- e.g. 'baseline-sandbox'
    version         INTEGER     NOT NULL,
    digest_sha256   TEXT        NOT NULL,          -- canonical digest, the value the verdict cites
    document        JSONB       NOT NULL,          -- rules, allowlists, ceilings
    signature       TEXT,                          -- EdDSA JWT when signed policy is in use
    signed_by       TEXT,
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (policy_slug, version)
);

-- Ordered assignment. Most specific wins: workspace > tenant > policy > global
-- (see src/policy/resolve-binding.ts for the single implementation of this
-- precedence - this comment describes intent, that file is the contract).
CREATE TABLE IF NOT EXISTS scout_policy_binding (
    id              BIGSERIAL PRIMARY KEY,
    subject_kind    TEXT        NOT NULL CHECK (subject_kind IN ('tenant', 'workspace', 'policy', 'global')),
    subject_key     TEXT        NOT NULL,          -- tenant id, workspace id, sandbox policy name
    policy_id       BIGINT      NOT NULL REFERENCES scout_policy(id),
    priority        INTEGER     NOT NULL DEFAULT 100,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (subject_kind, subject_key)
);
