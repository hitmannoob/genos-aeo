// Sentry server-side (Node.js runtime) initialization.
// This file is loaded by @sentry/nextjs via `src/instrumentation.ts` on the server.
// Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init( {
  dsn,

  // Only enable Sentry when a DSN is explicitly provided.
  // When no DSN is set, the SDK no-ops and the app works fine without error reporting.
  enabled: !!dsn,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
} );
