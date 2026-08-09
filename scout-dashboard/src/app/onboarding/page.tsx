'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api, ApiError, API_BASE, unwrapList } from '@/lib/api';
import type { ApiKey } from '@/lib/types';
import { Brand } from '@/components/Brand';
import { ErrorState, LoadingState } from '@/components/LoadingAndError';

type Language = 'node' | 'python';

function nodeSnippet(apiKey: string, apiBase: string): string {
  return `import { Scout } from '@scout-security/client';

const scout = new Scout({
  apiKey: '${apiKey}',
  baseUrl: '${apiBase}',
});

async function main() {
  const agent = await scout.registerAgent({ name: 'my-first-agent', tools: ['send_email'] });
  const agentId = agent.agent_id || agent.id;

  await scout.assertAgentRunnable(agentId);

  const result = await scout.filter({
    agentId,
    prompt: 'Draft a reply to the customer email.',
    tools: ['send_email'],
  });

  if (result.blocked) {
    console.log('Blocked by Scout:', result.reason);
    return;
  }

  await scout.trackEvent({
    agentId,
    type: 'tool_call_completed',
    toolName: 'send_email',
  });
}

main();
`;
}

function pythonSnippet(apiKey: string, apiBase: string): string {
  return `from scout_client import Scout

scout = Scout(api_key="${apiKey}", base_url="${apiBase}")

agent = scout.register_agent(name="my-first-agent", tools=["send_email"])
agent_id = agent["agent_id"]

scout.assert_agent_runnable(agent_id)

result = scout.filter(
    agent_id=agent_id,
    prompt="Draft a reply to the customer email.",
    tools=["send_email"],
)

if result.get("blocked"):
    print("Blocked by Scout:", result.get("reason"))
else:
    scout.track_event(agent_id=agent_id, event_type="tool_call_completed", tool_name="send_email")
`;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { ready, isAuthenticated, organization } = useAuth();
  const [language, setLanguage] = useState<Language>('node');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !isAuthenticated) {
      router.replace('/login');
    }
  }, [ready, isAuthenticated, router]);

  async function loadKeys() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.apiKeys();
      setKeys(unwrapList<ApiKey>(res));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      loadKeys();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const created = await api.createApiKey('onboarding');
      setApiKey(created.key ?? created.secret ?? null);
      await loadKeys();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create API key');
    } finally {
      setGenerating(false);
    }
  }

  if (!ready || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base text-ink-muted">
        Loading Scout...
      </div>
    );
  }

  const snippet = language === 'node'
    ? nodeSnippet(apiKey ?? 'sk_live_your_api_key', API_BASE)
    : pythonSnippet(apiKey ?? 'sk_live_your_api_key', API_BASE);

  return (
    <div className="min-h-screen bg-base">
      <header className="flex h-16 items-center justify-between border-b border-base-border px-8">
        <Brand />
        <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
          Skip to dashboard
        </Link>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            Connect your first agent{organization?.name ? `, ${organization.name}` : ''}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Generate an API key, install the SDK, and send your first filtered prompt in a few
            minutes.
          </p>
        </div>

        {error ? <ErrorState message={error} onRetry={loadKeys} /> : null}

        <section className="panel px-5 py-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">1. Get an API key</h2>
          {loading ? (
            <LoadingState label="Checking existing keys" />
          ) : apiKey ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-muted">
                Copy this key now, it will not be shown again.
              </p>
              <code className="block break-all rounded-sm bg-base-panel2 px-3 py-2 font-mono text-sm text-accent">
                {apiKey}
              </code>
            </div>
          ) : keys.length > 0 ? (
            <p className="text-sm text-ink-muted">
              You already have {keys.length} API key{keys.length === 1 ? '' : 's'}. Manage them on
              the{' '}
              <Link href="/dashboard/api-keys" className="text-accent hover:text-accent-hover">
                API Keys
              </Link>{' '}
              page, or generate a fresh one for this walkthrough below.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              You do not have an API key yet. Generate one to connect your first agent.
            </p>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="mt-4 rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-base transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate API key'}
          </button>
        </section>

        <section className="panel px-5 py-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">2. Choose your language</h2>
          <div className="flex gap-2">
            {(['node', 'python'] as Language[]).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang)}
                className={`rounded-sm border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  language === lang
                    ? 'border-accent/50 bg-accent-soft text-accent'
                    : 'border-base-border text-ink-muted hover:text-ink'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>

          <p className="mt-4 text-sm text-ink-muted">
            {language === 'node' ? 'npm install @scout-security/client' : 'pip install requests'}
          </p>

          <pre className="scrollbar-thin mt-3 max-h-96 overflow-auto rounded-sm border border-base-border bg-base-panel2 p-4 text-xs text-ink">
            <code>{snippet}</code>
          </pre>
        </section>

        <section className="panel px-5 py-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">3. Send your first event</h2>
          <p className="text-sm text-ink-muted">
            Run the snippet above. Once your agent registers and sends a prompt through Scout, it
            will appear on the agents list.
          </p>
          <Link
            href="/dashboard/agents"
            className="mt-4 inline-block rounded-sm border border-base-border px-4 py-2 text-sm text-ink-muted hover:border-accent/50 hover:text-accent"
          >
            View agents
          </Link>
        </section>

        <p className="text-sm text-ink-faint">
          Need more detail. See the full{' '}
          <Link href="/docs" className="text-accent hover:text-accent-hover">
            documentation
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
