'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/dashboard/repository-security', label: 'Overview', exact: true },
  { href: '/dashboard/repository-security/repositories', label: 'Repositories' },
  { href: '/dashboard/repository-security/settings', label: 'Settings' },
];

export function RepoSecurityNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Repository security sections"
      className="mb-6 flex flex-wrap gap-2 border-b border-base-border pb-3"
    >
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-sm px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
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
  );
}
