# scout agent notes

## CRITICAL: Public GitHub hygiene (product files only)

Before any commit or push to GitHub, track **only files that make this product work**. Planning docs, prompt queues, competitor research, personal notes, runtime logs, secrets, and nested foreign product trees stay workstation-local (`.gitignore` + `git rm --cached`). Canonical rule: `/opt/lampp/htdocs/verlox/shared/workspace-governance/PUBLIC-GITHUB-HYGIENE.md` and `/opt/lampp/htdocs/verlox/.cursor/rules/public-github-hygiene.mdc`. Guard: `bash /opt/lampp/htdocs/verlox/scripts/guard-public-github-hygiene.sh`.

Git root: this directory (`origin` → `https://github.com/malike2356/scout`, private). Enforce the hygiene rule before every push.

## Repository secret scanning boundary

**Live path (now):** Carina Scout engine + OPS UI.
- Engine: `carina/02-backends/scout-engine/src/secret-scanning/`
- OPS: `https://ops.carinaai.uk/security/repository-security`
- Local scanner: `/opt/lampp/htdocs/verlox/shared/secrets/`

**Future path:** this standalone SaaS tree keeps the multi-tenant customer dashboard for a later cutover. Do not treat local `:3005` or Contabo `/home/malike/apps/scout` SaaS containers as the live operator surface.

Never ingest credential values, match text, source content, environment content, absolute workstation paths, or Git author emails. Completed programme prompts live under `/opt/lampp/htdocs/verlox/archive/archived-prompts-library/scout/repository-secret-scanning/`.
