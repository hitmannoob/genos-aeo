'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  getStoredOpenRouterKey,
  removeStoredOpenRouterKey,
  storeOpenRouterKey,
} from '@/lib/openRouterKey';
import type { UserProfile } from '@/types/userProfile';

export interface LocalUser {
  uid: string;
  email: string;
  displayName: string;
}

interface AuthContextType {
  user: LocalUser | null;
  userProfile: UserProfile | null;
  openRouterKey: string | null;
  loading: boolean;
  profileError: Error | null;
  saveOpenRouterKey: (key: string) => Promise<void>;
  clearOpenRouterKey: () => void;
  refreshUserProfile: () => Promise<void>;
  retryProfileLoad: () => Promise<void>;
}

const LOCAL_USER: LocalUser = {
  uid: 'local-user',
  email: 'local@genos.local',
  displayName: 'Local user',
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

class ProfileRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ProfileRequestError';
  }
}

export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthContext must be used within an AuthContextProvider');
  return context;
}

async function fetchProfileFromServer(
  method: 'GET' | 'POST'
): Promise<UserProfile> {
  const response = await fetch('/api/users/profile', {
    method,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.profile) {
    throw new ProfileRequestError(response.status, data?.error || 'Failed to load local profile');
  }
  return data.profile as UserProfile;
}

async function loadOrCreateProfile(): Promise<UserProfile> {
  try {
    return await fetchProfileFromServer('POST');
  } catch (error) {
    const shouldRetry = !(error instanceof ProfileRequestError)
      || error.status === 429
      || error.status >= 500;
    if (!shouldRetry) throw error;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return fetchProfileFromServer('POST');
  }
}

export function AuthContextProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [openRouterKey, setOpenRouterKeyState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<Error | null>(null);
  const sequenceRef = useRef(0);
  const openRouterKeyRef = useRef<string | null>(null);

  const initializeLocalSession = useCallback(async (key: string) => {
    const sequence = ++sequenceRef.current;
    openRouterKeyRef.current = key;
    setOpenRouterKeyState(key);
    setUser(LOCAL_USER);
    setUserProfile(null);
    setProfileError(null);
    setLoading(true);

    try {
      const profile = await loadOrCreateProfile();
      if (sequence === sequenceRef.current && openRouterKeyRef.current === key) {
        setUserProfile(profile);
      }
    } catch (error) {
      if (sequence === sequenceRef.current) {
        setProfileError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (sequence === sequenceRef.current) setLoading(false);
    }
  }, []);

  const refreshUserProfile = useCallback(async () => {
    const key = openRouterKeyRef.current;
    if (!key) return;
    const profile = await fetchProfileFromServer('GET');
    if (openRouterKeyRef.current === key) setUserProfile(profile);
  }, []);

  const retryProfileLoad = useCallback(async () => {
    const key = openRouterKeyRef.current;
    if (!key) return;
    await initializeLocalSession(key);
  }, [initializeLocalSession]);

  const saveOpenRouterKey = useCallback(async (key: string) => {
    const storedKey = storeOpenRouterKey(key);
    if (openRouterKeyRef.current) {
      sequenceRef.current += 1;
      openRouterKeyRef.current = storedKey;
      setOpenRouterKeyState(storedKey);
      setProfileError(null);
      return;
    }
    await initializeLocalSession(storedKey);
  }, [initializeLocalSession]);

  const clearOpenRouterKey = useCallback(() => {
    sequenceRef.current += 1;
    removeStoredOpenRouterKey();
    openRouterKeyRef.current = null;
    setOpenRouterKeyState(null);
    setUser(null);
    setUserProfile(null);
    setProfileError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const storedKey = getStoredOpenRouterKey();
    if (!storedKey) {
      setLoading(false);
      return;
    }
    void initializeLocalSession(storedKey);
  }, [initializeLocalSession]);

  const value = useMemo<AuthContextType>(() => ({
    user,
    userProfile,
    openRouterKey,
    loading,
    profileError,
    saveOpenRouterKey,
    clearOpenRouterKey,
    refreshUserProfile,
    retryProfileLoad,
  }), [
    user,
    userProfile,
    openRouterKey,
    loading,
    profileError,
    saveOpenRouterKey,
    clearOpenRouterKey,
    refreshUserProfile,
    retryProfileLoad,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
          Loading local workspace…
        </div>
      ) : profileError && user ? (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="max-w-md space-y-4 text-center">
            <h2 className="text-xl font-semibold text-foreground">The local profile could not load</h2>
            <p className="text-sm text-muted-foreground">{profileError.message}</p>
            <button
              type="button"
              onClick={() => void retryProfileLoad()}
              className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                clearOpenRouterKey();
                window.location.assign('/');
              }}
              className="ml-2 rounded-lg border border-border bg-card px-4 py-2 text-card-foreground hover:bg-muted"
            >
              Change API key
            </button>
          </div>
        </div>
      ) : children}
    </AuthContext.Provider>
  );
}

export { AuthContext };
