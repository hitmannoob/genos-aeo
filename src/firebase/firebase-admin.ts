import {
  cert,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { logger } from '@/lib/logger';

// Next.js dev re-evaluates this module in a fresh context per route
// compilation, so neither `admin.apps` nor `globalThis` reliably survive
// across requests. The init itself is still cheap and idempotent — we just
// suppress the log in dev to avoid spamming the terminal. Production runs
// this exactly once.
let app: App;

if (getApps().length === 0) {
  try {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!projectId) {
      throw new Error('Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID');
    }

    const usingEmulators = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

    if (usingEmulators) {
      app = initializeApp({ projectId });
    } else {
      if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
      }
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      app = initializeApp({
        credential: cert({
          projectId,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
      });
    }
  } catch (error) {
    logger.error('Firebase Admin SDK initialization failed', error);
    throw error;
  }
} else {
  app = getApps()[0];
}

export const auth = getAuth(app);
