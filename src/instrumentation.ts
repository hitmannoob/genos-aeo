// Next.js instrumentation hook.
// Sentry wiring is present in the repo (sentry.{client,server,edge}.config.ts)
// but deferred — not imported here so the app builds without @sentry/nextjs.
// To activate: `npm install` (package.json already lists @sentry/nextjs),
// uncomment the dynamic imports below, and set SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN.

export async function register(): Promise<void> {
  // if ( process.env.NEXT_RUNTIME === 'nodejs' ) {
  //   await import( '../sentry.server.config' );
  // }
  // if ( process.env.NEXT_RUNTIME === 'edge' ) {
  //   await import( '../sentry.edge.config' );
  // }
}
