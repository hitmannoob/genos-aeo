// Next.js instrumentation hook.
// Called once on server startup for each runtime (nodejs / edge).
// We use it to load the appropriate Sentry init file per runtime,
// per @sentry/nextjs docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/

export async function register(): Promise<void> {
  if ( process.env.NEXT_RUNTIME === 'nodejs' ) {
    await import( '../sentry.server.config' );
  }

  if ( process.env.NEXT_RUNTIME === 'edge' ) {
    await import( '../sentry.edge.config' );
  }
}
