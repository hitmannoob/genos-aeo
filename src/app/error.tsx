'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError( {
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
} ): React.ReactElement {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

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
