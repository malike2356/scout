'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/dashboard/governance', label: 'Overview', exact: true },
  { href: '/dashboard/governance/decisions', label: 'Decisions' },
  { href: '/dashboard/governance/policies', label: 'Policies' },
  { href: '/dashboard/governance/grants', label: 'Grants' },
  { href: '/dashboard/governance/incidents', label: 'Incidents' },
];

export function GovernanceNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Governance sections"
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
