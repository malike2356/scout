# scout agent notes

## CRITICAL: Public GitHub hygiene (product files only)

Before any commit or push to GitHub, track **only files that make this product work**. Planning docs, prompt queues, competitor research, personal notes, runtime logs, secrets, and nested foreign product trees stay workstation-local (`.gitignore` + `git rm --cached`). Canonical rule: `<workspace-root>/shared/workspace-governance/PUBLIC-GITHUB-HYGIENE.md` and `<workspace-root>/.cursor/rules/public-github-hygiene.mdc`. Guard: `bash <workspace-root>/scripts/guard-public-github-hygiene.sh`.

Git root: this directory (`origin` → `https://github.com/malike2356/scout`, private). Enforce the hygiene rule before every push.

## Repository secret scanning boundary

Not currently live anywhere. The legacy `carina/02-backends/scout-engine/` copy (which an older
version of this note called "Carina Scout engine + OPS UI, live now") was confirmed unused -
no process/container running on the production VPS - and has been removed; Carina's
`ops.carinaai.uk` panel that referenced it is itself not deployed either (502, no running
container). Carina's own `lib/scout.ts`/`routes/governance.ts` integration points are dormant
code, left in place at the owner's request but not wired to anything live.

This standalone tree (`scout-engine/`, `scout-dashboard/`, `scout-sdk/`) is Scout's only
remaining code. Local scanner reference: `<workspace-root>/shared/secrets/`.

Never ingest credential values, match text, source content, environment content, absolute workstation paths, or Git author emails. Completed programme prompts live under `<workspace-root>/archive/archived-prompts-library/scout/repository-secret-scanning/`.
