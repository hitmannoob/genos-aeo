'use client'
import React, { useEffect } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { useRouter, usePathname } from 'next/navigation';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps): React.ReactElement {
  const { user, userProfile, loading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Only redirect if not loading and user is null
    if (!loading && user == null) {
      router.push("/signin");
    }
  }, [user, loading, router]);

  // Credit-based redirect for users with default credits (new users).
  // Heuristic: if credits equals the onboarding grant exactly, treat as a
  // brand-new account that hasn't spent anything yet. Keep this in sync
  // with the default in userProfile.ts / userProfileServer.ts.
  useEffect(() => {
    // Only check credits if user is authenticated and user profile is loaded
    if (user && userProfile && !loading) {
      const hasDefaultCredits = userProfile.credits === 1000;

      if (hasDefaultCredits && !pathname.startsWith('/dashboard/add-brand')) {
        console.log('🎯 Redirecting new user with 1000 credits to add-brand flow');
        router.push('/dashboard/add-brand/step-1');
        return;
      }
    }
  }, [user, userProfile, loading, pathname, router]);

  // Show loading while auth state is being determined
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-lg">Loading...</div>
      </div>
    );
  }

  // If user is not authenticated, show loading while redirecting
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-lg">Redirecting to sign in...</div>
      </div>
    );
  }

  // If user is authenticated, render the children
  return <>{children}</>;
} 