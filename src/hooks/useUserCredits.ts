import { useAuthContext } from '@/context/AuthContext';

export function useUserCredits() {
  const { user, userProfile, refreshUserProfile } = useAuthContext();

  const updateCredits = async (amount: number): Promise<{ success: boolean; error?: any }> => {
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    await refreshUserProfile();
    return {
      success: false,
      error: `Credits are server-managed in Postgres; direct client mutation (${amount}) is disabled.`,
    };
  };

  const deduct = async (amount: number): Promise<{ success: boolean; error?: any }> => {
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    if (!userProfile || userProfile.credits < amount) {
      return { success: false, error: 'Insufficient credits' };
    }

    await refreshUserProfile();
    return {
      success: false,
      error: `Credits are server-managed in Postgres; direct client deduction (${amount}) is disabled.`,
    };
  };

  const add = async (amount: number): Promise<{ success: boolean; error?: any }> => {
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    await refreshUserProfile();
    return {
      success: false,
      error: `Credits are server-managed in Postgres; direct client credit addition (${amount}) is disabled.`,
    };
  };

  const hasCredits = (amount: number): boolean => {
    return userProfile ? userProfile.credits >= amount : false;
  };

  return {
    credits: userProfile?.credits || 0,
    updateCredits,
    deduct,
    add,
    hasCredits,
    loading: !userProfile && !!user
  };
} 
