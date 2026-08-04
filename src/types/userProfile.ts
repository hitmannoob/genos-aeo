export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  isNewUser?: boolean;
}
