'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getAuth, onAuthStateChanged, type User } from 'firebase/auth';
import firebaseApp from '@/firebase/config';
import type { UserProfile } from '@/types/userProfile';
import signOut from '@/firebase/auth/signOut';
import {
  getStoredOpenRouterKey,
  OPENROUTER_KEY_HEADER,
  removeStoredOpenRouterKey,
  storeOpenRouterKey,
} from '@/lib/openRouterKey';

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  openRouterKey: string | null;
  loading: boolean;
  profileError: Error | null;
  saveOpenRouterKey: (key: string) => Promise<void>;
  clearOpenRouterKey: () => void;
  refreshUserProfile: () => Promise<void>;
  retryProfileLoad: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const auth = getAuth(firebaseApp);

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

async function fetchProfileFromServer(user: User, method: 'GET' | 'POST'): Promise<UserProfile> {
  const idToken = await user.getIdToken();
  const response = await fetch('/api/users/profile', {
    method,
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.profile) {
    throw new ProfileRequestError(response.status, data?.error || 'Failed to load user profile');
  }
  return data.profile as UserProfile;
}

async function loadOrCreateProfile(user: User): Promise<UserProfile> {
  try {
    return await fetchProfileFromServer(user, 'POST');
  } catch (error) {
    const shouldRetry = !(error instanceof ProfileRequestError)
      || error.status === 429
      || error.status >= 500;
    if (!shouldRetry) throw error;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return fetchProfileFromServer(user, 'POST');
  }
}

export function AuthContextProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [openRouterKey, setOpenRouterKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<Error | null>(null);
  const authSequenceRef = useRef(0);
  const userRef = useRef<User | null>(null);

  const saveOpenRouterKey = useCallback(async (key: string) => {
    const activeUser = userRef.current;
    if (!activeUser) {
      throw new Error('Sign in again before adding an OpenRouter API key.');
    }

    const idToken = await activeUser.getIdToken();
    const response = await fetch('/api/openrouter/key', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        [OPENROUTER_KEY_HEADER]: key.trim(),
      },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.valid !== true) {
      throw new Error(payload?.error || 'OpenRouter could not verify this API key.');
    }
    if (userRef.current?.uid !== activeUser.uid) {
      throw new Error('Your sign-in changed while the key was being verified. Please try again.');
    }
    setOpenRouterKey(storeOpenRouterKey(key));
  }, []);

  const clearOpenRouterKey = useCallback(() => {
    removeStoredOpenRouterKey();
    setOpenRouterKey(null);
  }, []);

  const refreshUserProfile = useCallback(async () => {
    const activeUser = userRef.current;
    if (!activeUser) return;
    const profile = await fetchProfileFromServer(activeUser, 'GET');
    if (userRef.current?.uid === activeUser.uid) setUserProfile(profile);
  }, []);

  const retryProfileLoad = useCallback(async () => {
    const activeUser = userRef.current;
    if (!activeUser) return;
    const sequence = ++authSequenceRef.current;
    setLoading(true);
    setProfileError(null);
    try {
      const profile = await loadOrCreateProfile(activeUser);
      if (sequence === authSequenceRef.current && userRef.current?.uid === activeUser.uid) {
        setUserProfile(profile);
      }
    } catch (error) {
      if (sequence === authSequenceRef.current) {
        setProfileError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (sequence === authSequenceRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      const sequence = ++authSequenceRef.current;
      const previousUid = userRef.current?.uid;
      const switchedAccounts = Boolean(
        previousUid && nextUser?.uid && previousUid !== nextUser.uid
      );
      userRef.current = nextUser;
      setUser(nextUser);
      setUserProfile(null);
      setProfileError(null);

      if (switchedAccounts) {
        removeStoredOpenRouterKey();
        setOpenRouterKey(null);
      }

      if (!nextUser) {
        removeStoredOpenRouterKey();
        setOpenRouterKey(null);
        setLoading(false);
        return;
      }

      setOpenRouterKey(getStoredOpenRouterKey());
      setLoading(true);
      try {
        const profile = await loadOrCreateProfile(nextUser);
        if (sequence === authSequenceRef.current && userRef.current?.uid === nextUser.uid) {
          setUserProfile(profile);
        }
      } catch (error) {
        if (sequence === authSequenceRef.current) {
          setProfileError(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        if (sequence === authSequenceRef.current) setLoading(false);
      }
    });

    return () => {
      authSequenceRef.current += 1;
      unsubscribe();
    };
  }, []);

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
        <div className="flex min-h-screen items-center justify-center bg-background text-foreground">Loading…</div>
      ) : profileError && user ? (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="max-w-md space-y-4 text-center">
            <h2 className="text-xl font-semibold text-foreground">We couldn&apos;t load your profile</h2>
            <p className="text-sm text-muted-foreground">{profileError.message}</p>
            <button
              type="button"
              onClick={retryProfileLoad}
              className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="ml-2 rounded-lg border border-border bg-card px-4 py-2 text-card-foreground hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : children}
    </AuthContext.Provider>
  );
}

export { AuthContext };
