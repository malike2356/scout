import { Scout, withScoutMonitoring } from '../src/index.js';

const scout = new Scout({
  apiKey: process.env.SCOUT_API_KEY || 'sk_live_your_api_key',
  baseUrl: process.env.SCOUT_API_URL || 'http://localhost:4444',
});

async function main() {
  const agent = await scout.registerAgent({
    name: 'sales-assistant',
    tools: ['send_email', 'read_crm'],
  });

  console.log('Registered agent:', agent.id);

  const filterResult = await scout.filter({
    agentId: agent.id,
    prompt: 'Draft a follow up email to the lead from yesterday.',
    tools: ['send_email'],
  });

  if (filterResult.blocked) {
    console.log('Blocked by Scout:', filterResult.reason);
    return;
  }

  console.log('Prompt cleared, calling tool...');

  const sendEmail = withScoutMonitoring(
    scout,
    {
      agentId: agent.id,
      toolName: 'send_email',
      getPrompt: (to: string, body: string) => body,
    },
    async (to: string, body: string) => {
      console.log(`(pretend) sending email to ${to}: ${body}`);
      return { sent: true };
    }
  );

  await sendEmail('lead@example.com', 'Following up on our conversation.');

  const status = await scout.getStatus(agent.id);
  console.log('Agent status:', status.status);
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exitCode = 1;
});
