'use client'
import React, { useEffect } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import { useRouter, usePathname } from 'next/navigation';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps): React.ReactElement {
  const { user, userProfile, loading } = useAuthContext();
  const { brands, loading: brandsLoading } = useBrandContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Only redirect if not loading and user is null
    if (!loading && user == null) {
      router.push("/signin");
    }
  }, [user, loading, router]);

  // Send users with no brands into the add-brand flow. The previous
  // heuristic used `userProfile.credits === 1000` as a "new user" tell, but
  // any paid user who happened to land on exactly 1000 (top-up, refund) got
  // force-redirected. `brands.length === 0` is the actual condition we care
  // about — onboarding is "complete" once at least one brand exists.
  useEffect(() => {
    if (
      user &&
      userProfile &&
      !loading &&
      !brandsLoading &&
      brands.length === 0 &&
      !pathname.startsWith('/dashboard/add-brand')
    ) {
      console.log('🎯 Redirecting user with no brands to add-brand flow');
      router.push('/dashboard/add-brand/step-1');
    }
  }, [user, userProfile, loading, brandsLoading, brands.length, pathname, router]);

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