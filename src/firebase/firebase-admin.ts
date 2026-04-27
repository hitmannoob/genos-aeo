import * as admin from 'firebase-admin';

// Next.js dev re-evaluates this module in a fresh context per route
// compilation, so neither `admin.apps` nor `globalThis` reliably survive
// across requests. The init itself is still cheap and idempotent — we just
// suppress the log in dev to avoid spamming the terminal. Production runs
// this exactly once.
const isProd = process.env.NODE_ENV === 'production';

if (!admin.apps.length) {
  try {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!projectId) {
      throw new Error('Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID');
    }

    const usingEmulators = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

    if (usingEmulators) {
      admin.initializeApp({ projectId });
      if (isProd) console.log('✅ Firebase Admin SDK initialized in EMULATOR mode');
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
      });
      if (isProd) console.log('✅ Firebase Admin SDK initialized with service account');
    }
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization error:', error);
    throw error;
  }
}

export const auth = admin.auth();

export default admin;
