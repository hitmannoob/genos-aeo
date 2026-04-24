'use client';

// Root error boundary for the App Router.
// Sentry reporting is deferred — add `Sentry.captureException(error)` in the
// useEffect below once @sentry/nextjs is installed.
// See: https://nextjs.org/docs/app/api-reference/file-conventions/error

export default function GlobalError( {
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
} ): React.ReactElement {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h2>Something went wrong.</h2>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          marginTop: '1rem',
          padding: '0.5rem 1rem',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  );
}
