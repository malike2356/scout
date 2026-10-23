# Channel-native Scout kill switch (design)

**Status:** APPROVED DIRECTION (2026-07-28)  
**Product rule:** A kill switch that only lives behind web login is weaker than the emergency it claims to solve. Channel access must be **faster**, not **weaker**.

## Problem

Dashboard-only kill requires: find app, load, login, navigate, press. In a real incident that latency is the failure mode. Operators already live in Telegram / WhatsApp / Slack. Scout must halt agents from those channels in seconds, with auth and audit.

Marketing already promises phone one-button halt (`scout/marketing/email-nurture-sequence-1-3.md`). The SaaS cut does not deliver that yet. Live [console.labyrinthscout.com](https://console.labyrinthscout.com/) has strong console kill and outbound Telegram/WhatsApp **alerts**, but not a first-class inbound "type /kill in chat" operator loop for external SaaS tenants.

## Non-goals

- Free-text "please stop" in any group chat
- Letting normal agent conversation trigger kill
- Replacing the enterprise console UI
- Cutting over `console.labyrinthscout.com` to the SaaS dashboard

## Goals

1. Panic halt from a daily channel in under ~2 seconds after the bot chat is open
2. Authenticated, allowlisted operators only
3. Explicit commands (or buttons), never free text intent
4. Full audit trail with a human-readable incident id
5. Graduated controls (not only nuclear kill)
6. Resume is harder than kill (dashboard or second factor)

## Control levels

| Level | Command / button | Effect |
|-------|------------------|--------|
| L1 Pause worker | `/pause <agent>` | Mark one agent paused; filter still allowed, tools blocked |
| L2 Stop tools | `/tools-off <agent\|all>` | Block tool execution; prompts may still be filtered |
| L3 Freeze org | `/freeze` | All org agents: no filter/events/tools (same as SaaS `suspended` today) |
| L4 Full kill | `/kill` | Org-wide freeze + audit critical + optional push to Keprix listeners when linked |
| L5 Disarm / resume | `/resume` | Requires confirm + stronger auth; restores `offline` |

Default panic path for linked operators: **`/kill`** (L4).

## Authorization model

### Linking (one-time, high friction OK)

1. Dashboard Settings → Channels → "Link Telegram"
2. Scout shows a short-lived code `scout-link-XXXX`
3. User messages the bot `/start scout-link-XXXX`
4. Bot binds `telegram_user_id` + `chat_id` → `organization_id` + `dashboard_user_id`
5. Store role: `owner` | `operator` (only these may kill)

WhatsApp: link via WhatsApp Business webhook + verified phone on the org allowlist.

### Runtime auth (low friction)

Inbound update is accepted only if:

- `chat_id` / `user_id` (Telegram) or WA phone is in `channel_operator_links`
- `enabled = true`
- role allows the command level
- optional: org has Monitor+ plan with killswitch feature

Reject unknown chats with no detail (avoid probing).

### Confirmation policy

| Action | Confirm |
|--------|---------|
| `/status` | none |
| `/pause`, `/tools-off` (single agent) | none |
| `/freeze`, `/kill` | **one** inline button `CONFIRM KILL` (or reply `CONFIRM`) within 30s |
| `/resume` | confirm + (dashboard password re-entry **or** second linked channel ack) |

Rationale: zero-confirm `/kill` is fastest but catastrophic on pocket press. One confirm button still beats web login and stays under a few seconds.

Panic mode (optional org setting): skip confirm for `/kill` only after link + explicit "enable panic mode" in dashboard. Default **off**.

## Command flow (Telegram)

```text
Operator -> Telegram Bot API webhook -> scout-messaging-gateway
  -> auth allowlist
  -> parse command
  -> (confirm if required)
  -> call scout-engine control API (internal)
  -> write audit row
  -> reply: "All N agents halted. Audit: K-2026-07-28-001"
```

### Commands

```text
/status
/pause <agent_id|name>
/tools-off <agent_id|name|all>
/freeze
/kill
/resume
/help
```

Aliases: `/scout-stop` = `/kill`, `/halt` = `/kill`.

### Engine effects

Reuse SaaS kill path:

- Set `connected_agents.status = 'suspended'` for org (or one agent for L1/L2)
- Public `/v1` already returns 403 `kill_switch` when suspended (pilot readiness)
- SDK `assertAgentRunnable` already throws on kill

For Keprix-linked deployments: also publish to the sidecar's own kill listeners; do not block
console shipping on that.

## Audit log schema

Migration table `channel_control_events`:

```sql
CREATE TABLE channel_control_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_code TEXT UNIQUE NOT NULL,           -- K-2026-07-28-001
  organization_id UUID NOT NULL REFERENCES organizations(id),
  actor_user_id UUID REFERENCES dashboard_users(id),
  channel TEXT NOT NULL,                     -- telegram | whatsapp | slack | sms
  channel_user_ref TEXT NOT NULL,            -- telegram user id / wa phone
  chat_ref TEXT,                             -- chat id
  command TEXT NOT NULL,                     -- kill | freeze | pause | resume | ...
  level TEXT NOT NULL,                       -- L1..L5
  scope TEXT NOT NULL,                       -- org | agent
  agent_id UUID,
  agents_affected INT NOT NULL DEFAULT 0,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  result TEXT NOT NULL,                      -- ok | denied | error
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Also table `channel_operator_links` for allowlist bindings.

## Channel rules

### Telegram

- Private bot chat preferred for kill (not large groups)
- If used in a group: only allowlisted user_ids; bot must be admin or ignore others
- Webhook secret token header required
- Rate limit: max 5 destructive commands / user / 10 minutes

### WhatsApp

- Business API inbound messages only from allowlisted E.164 numbers
- Same command vocabulary
- Template messages for outbound alerts; session messages for commands when in-window

### Slack (phase 2)

- Slash commands `/scout kill` with signing secret
- Map Slack user → org operator link

### SMS (phase 2)

- Short codes: `KILL` / `STATUS` from allowlisted MSISDN
- Higher fraud risk; require panic-mode org flag

## Where it lives in the repo

| Path | Role |
|------|------|
| `scout/docs/CHANNEL-KILL-SWITCH-DESIGN.md` | This design (source of truth) |
| `scout/scout-engine/src/messaging/` | Gateway: webhooks, command parse, auth |
| `scout/scout-engine/src/api/webhooks/telegram.ts` | Telegram webhook |
| `scout/scout-engine/src/api/webhooks/whatsapp.ts` | WhatsApp webhook |
| `scout/scout-engine/src/db/migrations/01x-channel-control.sql` | Links + audit |
| `scout/scout-dashboard` Settings → Channels | Link UX |
| Pending prompts | `01-pending_prompts/scout-channel-kill/` |

Do **not** put the SaaS messaging gateway inside live `console.labyrinthscout.com` until a migration prompt. Console keeps its own kill UI; SaaS gets channel-native kill for `gate.*` (or chosen host) tenants.

## Sales line (allowed once built)

"Scout's kill switch lives where you already live. Telegram, WhatsApp, SMS. No separate app hunt. Seconds from panic to halt, with an audit id back in chat."

Do not claim this until Telegram inbound `/kill` is live and e2e tested.

## Open founder choices

1. Host for SaaS + webhooks: prefer `gate.labyrinthscout.com` (not replacing console)
2. Default confirm: **CONFIRM button** (recommended) vs panic-mode no-confirm
3. First channel to ship: **Telegram only**, then WhatsApp
