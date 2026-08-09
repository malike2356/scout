'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Brand } from '@/components/Brand';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
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
          <h1 className="text-lg font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">Runtime security for autonomous agents.</p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded-sm border border-base-border bg-base px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                placeholder="********"
              />
            </label>

            {error ? <p className="text-sm text-danger">{error}</p> : null}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-base transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="mt-5 text-center text-sm text-ink-muted">
          Do not have an account?{' '}
          <Link href="/signup" className="text-accent hover:text-accent-hover">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
