'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brand } from './Brand';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/agents', label: 'Agents' },
  { href: '/dashboard/alerts', label: 'Alerts' },
  { href: '/dashboard/scores', label: 'Scores' },
  { href: '/dashboard/repository-security', label: 'Repository Security' },
  { href: '/dashboard/api-keys', label: 'API Keys' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-base-border bg-base-panel2 px-4 py-5">
      <div className="mb-8 px-1">
        <Brand />
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-muted hover:bg-base-panel hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-1 border-t border-base-border pt-4">
        <Link
          href="/docs"
          className="rounded-sm px-3 py-2 text-sm text-ink-faint transition-colors hover:bg-base-panel hover:text-ink"
        >
          Docs
        </Link>
        <Link
          href="/onboarding"
          className="rounded-sm px-3 py-2 text-sm text-ink-faint transition-colors hover:bg-base-panel hover:text-ink"
        >
          Onboarding
        </Link>
      </div>
    </aside>
  );
}
