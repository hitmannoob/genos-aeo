import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  try {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!projectId) {
      throw new Error('Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID');
    }

    const usingEmulators = !!(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);

    if (usingEmulators) {
      // Emulator mode: no real credentials needed. Admin SDK picks up the
      // *_EMULATOR_HOST env vars automatically.
      admin.initializeApp({ projectId });
      console.log('✅ Firebase Admin SDK initialized in EMULATOR mode');
      console.log('📋 Project ID:', projectId);
    } else {
      if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
      }
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
        databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
      });
      console.log('✅ Firebase Admin SDK initialized with service account');
      console.log('📋 Project ID:', projectId);
    }
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization error:', error);
    throw error;
  }
}

// Export Firebase Admin services with error handling
export const firestore = admin.firestore();
export const auth = admin.auth();
export const adminApp = admin.app();

// Re-export FieldValue so server code can use
// `FieldValue.serverTimestamp()` / `FieldValue.increment()` without a
// separate `firebase-admin` import. Prefer this over `admin.firestore.FieldValue`.
export const FieldValue = admin.firestore.FieldValue;

// Helper function to test Firestore connection
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    // Try to read from a test collection
    const testDoc = await firestore.collection('test').limit(1).get();
    console.log('✅ Firestore connection test successful');
    return true;
  } catch (error) {
    console.error('❌ Firestore connection test failed:', error);
    return false;
  }
}

export default admin; 