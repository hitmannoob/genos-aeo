export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  credits: number;
  createdAt: string | null;
  lastLoginAt: string | null;
  isNewUser?: boolean;
}
