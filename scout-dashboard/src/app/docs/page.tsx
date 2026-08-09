import Link from 'next/link';
import { Brand } from '@/components/Brand';
import { PLANS } from '@/lib/plans';

const SECTIONS = [
  { id: 'getting-started', label: 'Getting started' },
  { id: 'api-reference', label: 'API reference' },
  { id: 'sdk', label: 'SDK' },
  { id: 'security-concepts', label: 'Security concepts' },
  { id: 'plans', label: 'Plans' },
  { id: 'faq', label: 'FAQ' },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-base">
      <header className="flex h-16 items-center justify-between border-b border-base-border px-8">
        <Brand />
        <nav className="flex items-center gap-4 text-sm text-ink-muted">
          <Link href="/onboarding" className="hover:text-ink">
            Onboarding
          </Link>
          <Link href="/dashboard" className="hover:text-ink">
            Dashboard
          </Link>
        </nav>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-6 py-10">
        <aside className="sticky top-10 hidden h-fit w-48 shrink-0 flex-col gap-1 md:flex">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-sm px-3 py-1.5 text-sm text-ink-muted hover:bg-base-panel2 hover:text-ink"
            >
              {section.label}
            </a>
          ))}
        </aside>

        <main className="flex-1 flex-col gap-14">
          <section id="getting-started" className="mb-14 scroll-mt-10">
            <h1 className="text-2xl font-semibold text-ink">Documentation</h1>
            <h2 className="mt-8 text-lg font-semibold text-ink">Getting started</h2>
            <p className="mt-3 max-w-2xl text-sm text-ink-muted">
              Scout monitors and filters what your autonomous agents do at runtime. Sign up,
              generate an API key, and wrap your agent&apos;s tool calls with the SDK. Every prompt
              passes through Scout&apos;s distillation layers before it reaches a tool.
            </p>
            <ol className="mt-4 flex max-w-2xl flex-col gap-2 text-sm text-ink-muted">
              <li>1. Create an account and organization.</li>
              <li>2. Generate an API key from the onboarding flow or the API Keys page.</li>
              <li>3. Install the SDK (private pack: see scout-sdk/PUBLISH.md).</li>
              <li>4. Call registerAgent, assertAgentRunnable, filter, then trackEvent around tools.</li>
              <li>5. Watch agents and alerts on the dashboard. Kill switch returns HTTP 403 kill_switch.</li>
            </ol>
            <p className="mt-3 max-w-2xl text-sm text-ink-muted">
              Full runbook: docs/CLIENT-INTEGRATION.md in the Scout repo. Scout does not scan your git
              repository; you must instrument the agent runtime.
            </p>
          </section>

          <section id="api-reference" className="mb-14 scroll-mt-10">
            <h2 className="text-lg font-semibold text-ink">API reference</h2>
            <p className="mt-3 max-w-2xl text-sm text-ink-muted">
              All public endpoints live under <code className="font-mono text-accent">/v1</code> and
              require an API key: <code className="font-mono text-accent">Authorization: Bearer sk_live_xxx</code>.
            </p>
            <div className="panel mt-4 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-base-border text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-2 font-medium">Method</th>
                    <th className="px-4 py-2 font-medium">Path</th>
                    <th className="px-4 py-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs">
                  <tr className="border-b border-base-border">
                    <td className="px-4 py-2 text-accent">POST</td>
                    <td className="px-4 py-2 text-ink">/v1/agents/register</td>
                    <td className="px-4 py-2 font-sans text-ink-muted">Register a new agent, receive an agent id</td>
                  </tr>
                  <tr className="border-b border-base-border">
                    <td className="px-4 py-2 text-accent">POST</td>
                    <td className="px-4 py-2 text-ink">/v1/prompts/filter</td>
                    <td className="px-4 py-2 font-sans text-ink-muted">Run a prompt through the distillation layers</td>
                  </tr>
                  <tr className="border-b border-base-border">
                    <td className="px-4 py-2 text-accent">POST</td>
                    <td className="px-4 py-2 text-ink">/v1/events</td>
                    <td className="px-4 py-2 font-sans text-ink-muted">Submit an agent event for monitoring</td>
                  </tr>
                  <tr className="border-b border-base-border">
                    <td className="px-4 py-2 text-ok">GET</td>
                    <td className="px-4 py-2 text-ink">/v1/agents/:id/status</td>
                    <td className="px-4 py-2 font-sans text-ink-muted">Get the current status of an agent</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 text-ok">GET</td>
                    <td className="px-4 py-2 text-ink">/v1/health</td>
                    <td className="px-4 py-2 font-sans text-ink-muted">Health check, no auth required</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="sdk" className="mb-14 scroll-mt-10">
            <h2 className="text-lg font-semibold text-ink">SDK</h2>
            <p className="mt-3 max-w-2xl text-sm text-ink-muted">
              The <code className="font-mono text-accent">@scout-security/client</code> package
              wraps the four core calls: <code className="font-mono text-accent">registerAgent</code>,
              <code className="font-mono text-accent"> filter</code>, <code className="font-mono text-accent">trackEvent</code>,
              and <code className="font-mono text-accent">getStatus</code>. A mirrored Python client
              ships under <code className="font-mono text-accent">scout-sdk/python</code>. See the{' '}
              <Link href="/onboarding" className="text-accent hover:text-accent-hover">
                onboarding walkthrough
              </Link>{' '}
              for copy-paste snippets.
            </p>
          </section>

          <section id="security-concepts" className="mb-14 scroll-mt-10">
            <h2 className="text-lg font-semibold text-ink">Security concepts</h2>
            <div className="mt-3 grid max-w-2xl gap-4 text-sm text-ink-muted">
              <div>
                <h3 className="font-medium text-ink">PromptGuard layers</h3>
                <p className="mt-1">
                  Every prompt passes through three distillation layers before reaching a tool:
                  intent extraction, policy matching against your organization&apos;s rules, and a final
                  risk score. A prompt is only cleared when all three layers agree.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-ink">Kill switch</h3>
                <p className="mt-1">
                  Any agent can be suspended immediately from the dashboard. Once triggered, the
                  agent is marked killed and further tool calls through Scout are blocked until it
                  is manually re-enabled.
                </p>
              </div>
            </div>
          </section>

          <section id="plans" className="mb-14 scroll-mt-10">
            <h2 className="text-lg font-semibold text-ink">Plans</h2>
            <div className="mt-4 grid grid-cols-4 gap-4">
              {PLANS.map((plan) => (
                <div key={plan.id} className="panel px-4 py-4">
                  <h3 className="text-sm font-semibold text-ink">{plan.name}</h3>
                  <p className="text-lg font-semibold text-ink">{plan.price}</p>
                  <p className="mt-1 text-xs text-ink-muted">{plan.tagline}</p>
                  <ul className="mt-3 flex flex-col gap-1 text-xs text-ink-muted">
                    {plan.features.map((feature) => (
                      <li key={feature}>- {feature}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section id="faq" className="scroll-mt-10">
            <h2 className="text-lg font-semibold text-ink">FAQ</h2>
            <div className="mt-4 flex max-w-2xl flex-col gap-4 text-sm">
              <div>
                <h3 className="font-medium text-ink">Where does Scout run?</h3>
                <p className="mt-1 text-ink-muted">
                  Scout is a hosted engine your agents call over HTTPS. No code runs inside your
                  infrastructure beyond the lightweight SDK call.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-ink">What happens on the Free plan?</h3>
                <p className="mt-1 text-ink-muted">
                  Free covers one agent with basic prompt filtering and 7 day history, no credit
                  card required.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-ink">Can I change plans later?</h3>
                <p className="mt-1 text-ink-muted">
                  Yes, upgrade or manage billing from Settings at any time. Changes are handled
                  through Stripe Checkout and the Stripe customer portal.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
