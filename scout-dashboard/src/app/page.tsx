'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function RootPage() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!ready) return;
    router.replace(isAuthenticated ? '/dashboard' : '/login');
  }, [ready, isAuthenticated, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-base text-ink-muted">
      Loading Scout...
    </div>
  );
}
