import firebase_app from "../config";
import { signInWithEmailAndPassword, getAuth, type UserCredential } from "firebase/auth";

// Get the authentication instance using the Firebase app
const auth = getAuth(firebase_app);

export default async function signIn(
  email: string,
  password: string,
): Promise<{ result: UserCredential | null; error: unknown | null }> {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return { result, error: null };
  } catch (error) {
    return { result: null, error };
  }
}
