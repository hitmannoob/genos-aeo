import firebase_app from "../config";
import { signInWithPopup, GoogleAuthProvider, getAuth, type UserCredential } from "firebase/auth";

// Get the authentication instance using the Firebase app
const auth = getAuth(firebase_app);

// Create a Google Auth Provider instance
const googleProvider = new GoogleAuthProvider();

export default async function googleSignIn(): Promise<{
  result: UserCredential | null;
  error: unknown | null;
}> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return { result, error: null };
  } catch (error) {
    return { result: null, error };
  }
}
