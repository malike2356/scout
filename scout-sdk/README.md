# @scout-security/client

Official client for the Scout runtime security API (`/v1/*`).

Default API host: `https://console.labyrinthscout.com` (path-proxied `/v1`).  
Local: set `SCOUT_API_URL=http://localhost:4444`.

## Install (private pilot)

See [PUBLISH.md](./PUBLISH.md). Until npm publish:

```bash
npm run build && npm pack
npm install ./scout-security-client-0.1.0.tgz
```

## Usage

See `examples/governed-loop.ts` for the supervised agent loop (filter, assertAgentRunnable, trackEvent).

```typescript
import { Scout } from '@scout-security/client';

const scout = new Scout({ apiKey: process.env.SCOUT_API_KEY!, baseUrl: process.env.SCOUT_API_URL });
const agent = await scout.registerAgent({ name: 'my-agent', tools: ['send_email'] });
const agentId = agent.agent_id;

await scout.assertAgentRunnable(agentId);
const result = await scout.filter({ agentId, prompt: userInput });
if (result.blocked) return;
await scout.trackEvent({ agentId, type: 'tool_call_completed', toolName: 'send_email' });
```

Kill switch: if the operator suspends the agent, `filter` / `trackEvent` / `assertAgentRunnable` fail with `ScoutApiError.code === 'kill_switch'`.
