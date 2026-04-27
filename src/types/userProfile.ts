export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  credits: number;
  createdAt: any;
  lastLoginAt: any;
  isNewUser?: boolean;
}
