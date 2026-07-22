import { useAuthContext } from '@/context/AuthContext';

export function useUserCredits() {
  const { user, userProfile } = useAuthContext();

  return {
    credits: userProfile?.credits || 0,
    loading: !userProfile && !!user
  };
} 
