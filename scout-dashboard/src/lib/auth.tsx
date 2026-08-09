'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getStoredOrg, getToken, setStoredOrg, setToken } from './api';
import type { Organization } from './types';

interface AuthContextValue {
  token: string | null;
  organization: Organization | null;
  ready: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (payload: {
    email: string;
    password: string;
    organization_name: string;
    name?: string;
  }) => Promise<void>;
  logout: () => void;
  refreshOrg: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setTokenState(getToken());
    setOrganization(getStoredOrg());
    setReady(true);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    setToken(res.token);
    setTokenState(res.token);
    if (res.organization) {
      setStoredOrg(res.organization);
      setOrganization(res.organization);
    }
  }, []);

  const signup = useCallback(
    async (payload: { email: string; password: string; organization_name: string; name?: string }) => {
      const res = await api.signup(payload);
      setToken(res.token);
      setTokenState(res.token);
      if (res.organization) {
        setStoredOrg(res.organization);
        setOrganization(res.organization);
      }
    },
    []
  );

  const logout = useCallback(() => {
    setToken(null);
    setStoredOrg(null);
    setTokenState(null);
    setOrganization(null);
    router.push('/login');
  }, [router]);

  const refreshOrg = useCallback(async () => {
    try {
      const org = await api.org();
      setStoredOrg(org);
      setOrganization(org);
    } catch {
      // non-fatal: keep whatever org state we already have
    }
  }, []);

  const value = useMemo(
    () => ({
      token,
      organization,
      ready,
      isAuthenticated: Boolean(token),
      login,
      signup,
      logout,
      refreshOrg,
    }),
    [token, organization, ready, login, signup, logout, refreshOrg]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
