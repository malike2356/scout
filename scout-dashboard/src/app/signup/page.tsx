'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Brand } from '@/components/Brand';

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup({
        email,
        password,
        organization_name: organizationName,
        name: name || undefined,
      });
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand size={26} />
        </div>
        <div className="panel px-6 py-7">
          <h1 className="text-lg font-semibold text-ink">Create your account</h1>
          <p className="mt-1 text-sm text-ink-muted">Start on the Free plan, upgrade any time.</p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
              Organization name
              <input
                required
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                className="rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder="Acme Inc"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
              Your name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder="Jane Doe"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder="you@company.com"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
              Password
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder="At least 8 characters"
              />
            </label>

            {error ? <p className="text-sm text-danger">{error}</p> : null}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-base transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        </div>
        <p className="mt-5 text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:text-accent-hover">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
