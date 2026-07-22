import firebase_app from "../config";
import { signOut as firebaseSignOut, getAuth } from "firebase/auth";

// Get the authentication instance using the Firebase app
const auth = getAuth(firebase_app);

export default async function signOut(): Promise<{ error: unknown | null }> {
  try {
    await firebaseSignOut(auth);
    return { error: null };
  } catch (error) {
    return { error };
  }
}
