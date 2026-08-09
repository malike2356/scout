# scout agent notes

## CRITICAL: Public GitHub hygiene (product files only)

Before any commit or push to GitHub, track **only files that make this product work**. Planning docs, prompt queues, competitor research, personal notes, runtime logs, secrets, and nested foreign product trees stay workstation-local (`.gitignore` + `git rm --cached`). Canonical rule: `/opt/lampp/htdocs/verlox/shared/workspace-governance/PUBLIC-GITHUB-HYGIENE.md` and `/opt/lampp/htdocs/verlox/.cursor/rules/public-github-hygiene.mdc`. Guard: `bash /opt/lampp/htdocs/verlox/scripts/guard-public-github-hygiene.sh`.

Git root: this directory (`origin` → `https://github.com/malike2356/scout`, private). Enforce the hygiene rule before every push.

## Repository secret scanning boundary

Standalone Scout owns the detailed repository-secret-scanning security experience. The reusable local engine remains in `/opt/lampp/htdocs/verlox/shared/secrets/`. Scout may ingest and display only the minimized redacted metadata allowed by `/opt/lampp/htdocs/verlox/shared/workspace-governance/SECRET-SCANNING-OWNERSHIP.md`. Never ingest credential values, match text, source content, environment content, absolute workstation paths, or Git author emails.

Completed programme prompts live under `/opt/lampp/htdocs/verlox/archive/archived-prompts-library/scout/repository-secret-scanning/`. Do not implement this feature in the legacy Scout console inside Carina.
