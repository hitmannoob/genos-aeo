'use client'
import signIn from "@/firebase/auth/signIn";
import googleSignIn from "@/firebase/auth/googleSignIn";
import { useRouter } from 'next/navigation';
import { useState } from "react";
import type { FirebaseError } from 'firebase/app';
import Link from 'next/link';

function Page(): React.ReactElement {
  const [ email, setEmail ] = useState( '' );
  const [ password, setPassword ] = useState( '' );
  const [ isLoading, setIsLoading ] = useState( false );
  const [ isGoogleLoading, setIsGoogleLoading ] = useState( false );
  const [ error, setError ] = useState( '' );
  const router = useRouter();

  // Handle form submission
  const handleForm = async ( event: { preventDefault: () => void } ) => {
    event.preventDefault();
    
    setIsLoading( true );
    setError( '' ); // Clear any previous errors

    try {
      const { error: signInError } = await signIn(email.trim(), password);

      if (signInError) {
        let errorMessage = 'An error occurred during sign in. Please try again.';
        const firebaseError = signInError as FirebaseError;
        if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(firebaseError.code)) {
          errorMessage = 'The email or password is incorrect.';
        } else if (firebaseError.code === 'auth/invalid-email') {
          errorMessage = 'Please enter a valid email address.';
        } else if (firebaseError.code === 'auth/user-disabled') {
          errorMessage = 'This account has been disabled. Please contact support.';
        } else if (firebaseError.code === 'auth/too-many-requests') {
          errorMessage = 'Too many failed attempts. Please try again later.';
        }
        setError(errorMessage);
        return;
      }

      router.replace('/dashboard');
    } catch {
      setError('An error occurred during sign in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  // Handle Google sign-in
  const handleGoogleSignIn = async () => {
    setIsGoogleLoading( true );
    setError( '' ); // Clear any previous errors

    try {
      const { error: googleError } = await googleSignIn();

      if (googleError) {
        let errorMessage = 'An error occurred with Google sign-in. Please try again.';
        const firebaseError = googleError as FirebaseError;
        if (firebaseError.code === 'auth/popup-closed-by-user') {
          errorMessage = 'Sign-in was cancelled. Please try again.';
        } else if (firebaseError.code === 'auth/popup-blocked') {
          errorMessage = 'Pop-up was blocked by your browser. Please allow pop-ups and try again.';
        }
        setError(errorMessage);
        return;
      }

      router.replace('/dashboard');
    } catch {
      setError('An error occurred with Google sign-in. Please try again.');
    } finally {
      setIsGoogleLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-xs">
        <form onSubmit={handleForm} className="mb-4 rounded-xl border border-border bg-card px-8 pb-8 pt-6 shadow-md">
          <h1 className="mb-6 text-3xl font-bold text-foreground">Sign in</h1>
          
          {/* Error Message */}
          {error && (
            <div role="alert" aria-live="polite" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <p className="flex items-center text-sm text-destructive">
                <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </p>
            </div>
          )}
          <div className="mb-4">
            <label htmlFor="email" className="mb-2 block text-sm font-bold text-foreground">
              Email
            </label>
            <input
              onChange={( e ) => {
                setEmail( e.target.value );
                if ( error ) setError( '' ); // Clear error when user starts typing
              }}
              required
              type="email"
              name="email"
              id="email"
              placeholder="example@mail.com"
              autoComplete="email"
              value={email}
              className="w-full appearance-none rounded border border-input bg-background px-3 py-2 text-foreground shadow focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="mb-6">
            <label htmlFor="password" className="mb-2 block text-sm font-bold text-foreground">
              Password
            </label>
            <input
              onChange={( e ) => {
                setPassword( e.target.value );
                if ( error ) setError( '' ); // Clear error when user starts typing
              }}
              required
              type="password"
              name="password"
              id="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              className="w-full appearance-none rounded border border-input bg-background px-3 py-2 text-foreground shadow focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              type="submit"
              disabled={isLoading || isGoogleLoading}
              className="flex w-full items-center justify-center rounded bg-primary py-2 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Signing In...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </div>
          
          <div className="flex items-center my-4">
            <div className="flex-1 border-t border-border"></div>
            <span className="px-3 text-sm text-muted-foreground">or</span>
            <div className="flex-1 border-t border-border"></div>
          </div>
          
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading || isGoogleLoading}
            className="flex w-full items-center justify-center rounded border border-border bg-card px-4 py-2 font-semibold text-card-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGoogleLoading ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-current"></div>
                Signing in with Google...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>
        </form>
        {/* Add this below the signin form */}
        <div className="mt-4 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-primary hover:underline">Register</Link>
        </div>
      </div>
    </main>
  );
}

export default Page;
