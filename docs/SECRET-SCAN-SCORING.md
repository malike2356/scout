# Repository secret scanning and Scout Score

## Weighting

Scout Score keeps the existing category weights:

| Category | Weight |
|---|---|
| Exposure | 0.25 |
| Vulnerabilities | 0.35 |
| Compliance | 0.25 |
| Agent safety | 0.15 |

Repository secret findings are mirrored into `findings` with `finding_type = exposed_secret` and count inside the **exposure** category. Severity penalties match other exposure findings (critical 15, high 8, medium 4, low 2, info 0.5).

## Anti-manipulation safeguards

1. Only `status = open` mirror rows in the last 30 days affect exposure.
2. Repository-secret penalties are capped at **40 points** inside the exposure calculation so reopen spam cannot alone zero the score.
3. Lifecycle truth is `repo_secret_findings.remediation_status`. Resolving a secret finding closes the mirror (`remediated` / `false_positive` / `wont_fix`) so it leaves the open exposure set.
4. Deduplicated repeats (`seen_count` bumps) do not create new mirror rows.
5. Reopen after resolved/accepted-risk/false-positive creates a new open cycle and may re-apply score pressure; that is intentional.

## Related surfaces

- Aggregate posture: `GET /v1/repository-security/posture` (`schema_version` 1.0.0)
- Redacted export: `GET /v1/repository-security/export` and dashboard export
- Decision note: `scout-engine/src/secret-scanning/DECISION.md`
