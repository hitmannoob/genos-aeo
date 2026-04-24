// Import the functions you need from the SDKs you need
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
let firebase_app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Firestore
export const db = getFirestore(firebase_app);
export const auth = getAuth(firebase_app);

// Connect to local emulators when enabled. Guarded so HMR/re-imports don't re-connect.
const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
const g = globalThis as unknown as { __FIREBASE_EMULATORS_CONNECTED__?: boolean };
if (useEmulator && !g.__FIREBASE_EMULATORS_CONNECTED__) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  g.__FIREBASE_EMULATORS_CONNECTED__ = true;
  console.log("🔥 Firebase client connected to local emulators (Auth:9099, Firestore:8080)");
}

// This line exports the initialized Firebase app instance as the default export of this module.
// By doing so, other parts of the application can import this file and use the Firebase app instance directly.
export default firebase_app;
