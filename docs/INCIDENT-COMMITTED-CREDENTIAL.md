# Incident runbook: suspected committed credential

## Scope

Use this when a local scanner, Scout finding, or human review suggests a credential was committed to a Git repository. Scout stores redacted metadata only; rotation happens outside Scout.

## Immediate steps

1. Treat the credential as compromised. Do not paste values into chat, tickets, Scout evidence notes, or commits.
2. Identify the provider and account from rule ID and repository alias only.
3. Revoke or rotate the credential in the provider console.
4. Update workstation / secret-manager configuration with the replacement.
5. In Scout, move the finding to `rotation-in-progress`, then `verification-pending`, then `resolved` with evidence that contains no secret values.
6. Re-run a local staged or current scan (`shared/secrets/secret_scan.py`) and optionally deliver with `SCOUT_DELIVER=1`.
7. If history exposure is likely, schedule a history scan after local policy approval (`scout_poller.py` with `allow_history_scans`).

## Scout operator actions

- Confirm the repository connector is correct and not revoked/offboarded.
- Check overdue remediation on Repository Security overview.
- Escalate via existing alert channels if rotation stalls past the overdue threshold.
- Offboard the connector when the repository leaves the programme.

## Do not

- Ask Scout to execute workstation commands.
- Store match text, source content, absolute paths, or author emails in Scout.
- Mark resolved without external rotation evidence.
