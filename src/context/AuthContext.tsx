'use client'
import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from 'react';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import firebase_app from '@/firebase/config';
import type { UserProfile } from '@/types/userProfile';

// Module-level no-ops so the SSR fallback context value is referentially stable.
const NOOP_ASYNC = async () => {};
const SSR_AUTH_VALUE: AuthContextType = {
  user: null,
  userProfile: null,
  loading: true,
  profileError: null,
  refreshUserProfile: NOOP_ASYNC,
  retryProfileLoad: NOOP_ASYNC,
};

// Initialize Firebase auth instance
const auth = getAuth( firebase_app );

// Create the authentication context with proper typing
interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  // Set when profile fetch/create exhausted its retries. Lets consumers (and
  // the provider's own fallback UI) distinguish "still loading" from
  // "couldn't load and won't on its own".
  profileError: Error | null;
  refreshUserProfile: () => Promise<void>;
  retryProfileLoad: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  userProfile: null,
  loading: true,
  profileError: null,
  refreshUserProfile: async () => {},
  retryProfileLoad: async () => {},
});

// Custom hook to access the authentication context
export const useAuthContext = () => useContext( AuthContext );

interface AuthContextProviderProps {
  children: ReactNode;
}

// One automatic retry with a short backoff. Profile creation can fail on
// signup if the auth token hasn't propagated to Firestore yet (race window
// is tens of ms); a single retry resolves nearly all of these.
async function fetchProfileFromServer(user: User, method: 'GET' | 'POST'): Promise<UserProfile> {
  const idToken = await user.getIdToken();
  const response = await fetch('/api/users/profile', {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.profile) {
    throw new Error(data?.error || 'Failed to load user profile');
  }

  return data.profile as UserProfile;
}

async function loadOrCreateProfile(user: User): Promise<UserProfile> {
  try {
    return await fetchProfileFromServer(user, 'POST');
  } catch (firstError) {
    console.warn('⚠️ Profile load failed, retrying once:', firstError);
    await new Promise((r) => setTimeout(r, 600));
    return fetchProfileFromServer(user, 'POST');
  }
}

export function AuthContextProvider( { children }: AuthContextProviderProps ): React.ReactElement {
  // Set up state to track the authenticated user and loading status
  const [ user, setUser ] = useState<User | null>( null );
  const [ userProfile, setUserProfile ] = useState<UserProfile | null>( null );
  const [ loading, setLoading ] = useState( true );
  const [ profileError, setProfileError ] = useState<Error | null>( null );
  const [ isClient, setIsClient ] = useState( false );

  // Function to refresh user profile data
  const refreshUserProfile = useCallback(async () => {
    if (user) {
      const profile = await fetchProfileFromServer(user, 'GET');
      setUserProfile(profile);
    }
  }, [user]);

  const retryProfileLoad = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setProfileError(null);
    try {
      const profile = await loadOrCreateProfile(user);
      setUserProfile(profile);
    } catch (e) {
      console.error('❌ Profile retry failed:', e);
      setProfileError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Function to handle user authentication state changes
  const handleAuthStateChange = async (nextUser: User | null) => {
    if (nextUser) {
      // User is signed in - load/create their profile.
      // Hold loading=true through the profile fetch/create so consumers like
      // useUserCredits don't briefly see user-without-profile (which would
      // surface as credits=0 and trigger spurious "Insufficient Credits"
      // states on freshly signed-up accounts).
      setLoading(true);
      setProfileError(null);
      setUser(nextUser);

      try {
        const profile = await loadOrCreateProfile(nextUser);
        setUserProfile(profile);
      } catch (error) {
        console.error('❌ Error handling user profile (after retry):', error);
        setProfileError(error instanceof Error ? error : new Error(String(error)));
        setUserProfile(null);
      }
    } else {
      // User is signed out
      setUser(null);
      setUserProfile(null);
      setProfileError(null);
    }

    // Set loading to false once authentication state is determined
    setLoading(false);
  };

  useEffect( () => {
    // Mark as client-side to prevent hydration mismatch
    setIsClient( true );

    // Subscribe to the authentication state changes
    const unsubscribe = onAuthStateChanged( auth, handleAuthStateChange );

    // Unsubscribe from the authentication state changes when the component is unmounted
    return () => unsubscribe();
  }, [] );

  const contextValue = useMemo<AuthContextType>(
    () => ({ user, userProfile, loading, profileError, refreshUserProfile, retryProfileLoad }),
    [user, userProfile, loading, profileError, refreshUserProfile, retryProfileLoad]
  );

  // Prevent hydration mismatch by rendering same content on server and client initially
  if ( !isClient ) {
    return (
      <AuthContext.Provider value={SSR_AUTH_VALUE}>
        {children}
      </AuthContext.Provider>
    );
  }

  // Provide the authentication context to child components
  return (
    <AuthContext.Provider value={contextValue}>
      {loading ? (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-foreground">Loading...</div>
        </div>
      ) : profileError && user ? (
        <div className="min-h-screen bg-background flex items-center justify-center px-4">
          <div className="max-w-md text-center space-y-4">
            <h2 className="text-xl font-semibold text-foreground">We couldn't load your profile</h2>
            <p className="text-sm text-muted-foreground">
              {profileError.message || 'An unexpected error occurred while loading your account.'}
            </p>
            <button
              onClick={retryProfileLoad}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}
