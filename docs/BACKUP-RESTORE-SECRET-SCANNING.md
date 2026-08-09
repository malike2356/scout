# Backup and restore: repository secret scanning

## Tables to include

- `repo_connectors`
- `repo_secret_scan_runs`
- `repo_secret_findings`
- `repo_secret_remediation_events`
- `repo_secret_ingestion_receipts`
- `repo_secret_workspace_settings`
- `repo_secret_scan_requests`
- Mirror rows in `findings` where `finding_type = 'exposed_secret'`
- Related `alert_history` / `alert_rules` for the workspace

## Backup

Use the same Postgres backup process as the Scout SaaS database (logical dump or volume snapshot). Include migrations `011-repository-secret-scanning.sql` and `012-repository-secret-settings.sql` in restore validation.

Example logical dump (operator-run):

```bash
pg_dump "$DATABASE_URL" \
  --table=repo_connectors \
  --table=repo_secret_scan_runs \
  --table=repo_secret_findings \
  --table=repo_secret_remediation_events \
  --table=repo_secret_ingestion_receipts \
  --table=repo_secret_workspace_settings \
  --table=repo_secret_scan_requests \
  -f scout-repo-secret-backup.sql
```

## Restore checks

1. Restore into a non-production database first.
2. Confirm `GET /v1/health` reports `repository_secret_scanning.tables_ready = true`.
3. Confirm a tenant can list connectors and findings only for its own organization.
4. Confirm exports and alert payloads remain free of forbidden fields.

## Retention

The secret-scan maintenance job deletes aged rows according to workspace `retention_days` / `retain_until`. Backups may retain older copies outside the live retention window; treat backup media as sensitive metadata even though credential values are not stored.
