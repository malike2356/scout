/**
 * Canonical supervised agent loop for Scout SaaS pilots.
 *
 * Scout does not scan your git repo. You must call filter / assertAgentRunnable /
 * trackEvent from your runtime.
 *
 * Run against a local engine:
 *   SCOUT_API_KEY=sk_live_... SCOUT_API_URL=http://localhost:4444 npx tsx examples/governed-loop.ts
 */
import { Scout, ScoutApiError } from '../src/index.js';

async function main(): Promise<void> {
  const apiKey = process.env.SCOUT_API_KEY;
  if (!apiKey) {
    throw new Error('Set SCOUT_API_KEY');
  }

  const scout = new Scout({
    apiKey,
    baseUrl: process.env.SCOUT_API_URL || 'http://localhost:4444',
  });

  const agent = await scout.registerAgent({
    name: `governed-demo-${Date.now()}`,
    type: 'autonomous',
    tools: ['send_email', 'read_file'],
  });
  const agentId = agent.agent_id || agent.id;
  console.log('registered', agentId);

  const userPrompt = process.argv[2] || 'Draft a polite follow-up email.';

  try {
    await scout.assertAgentRunnable(agentId);

    const filtered = await scout.filter({ agentId, prompt: userPrompt, tools: ['send_email'] });
    if (filtered.blocked) {
      console.log('blocked', filtered.reason);
      return;
    }

    console.log('allowed', filtered.filtered_prompt);

    // Pretend tool call
    await scout.trackEvent({
      agentId,
      type: 'tool_call_completed',
      toolName: 'send_email',
      message: 'send_email finished',
    });
    console.log('event accepted');
  } catch (err) {
    if (err instanceof ScoutApiError && err.code === 'kill_switch') {
      console.log('kill switch active; stopping loop');
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
