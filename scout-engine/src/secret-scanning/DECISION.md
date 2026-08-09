# Repository secret scanning: findings mapping decision

## Decision

Standalone Scout stores repository secret-scan lifecycle in dedicated tables:

- `repo_connectors`
- `repo_secret_scan_runs`
- `repo_secret_findings`
- `repo_secret_remediation_events`
- `repo_secret_ingestion_receipts`

`repo_secret_findings.remediation_status` is the single source of lifecycle truth.

## Mapping into Scout Score

When a secret finding is accepted (new or reopened), Scout also inserts or updates a row in `findings` with:

- `finding_type = 'exposed_secret'`
- `tool_name = scanner_name`
- nullable `target_id` / `scan_run_id` (migration 011 drops NOT NULL so agent and secret paths share this shape)
- `fingerprint` namespaced as `repo-secret:{connector_id}:{fingerprint}` to avoid colliding with network-scan fingerprints
- `evidence` containing only approved metadata (rule_id, relative_path, line, commit_id, connector_id); never match text or credential values

`repo_secret_findings.scout_finding_id` links to that mirror row. Remediation transitions update both tables so score exposure stays aligned without a second lifecycle authority.

## Why not only `findings`

Network `findings` uniqueness is `(fingerprint, target_id)`. Secret scans are repository-connector scoped, need remediation states beyond the network enum, and must support ingest audit receipts and idempotency without overloading `scan_runs` (which require a network `target_id`).

## Scoring

See `/opt/lampp/htdocs/verlox/scout/docs/SECRET-SCAN-SCORING.md` for exposure weighting and anti-manipulation caps on `exposed_secret` mirror rows.
