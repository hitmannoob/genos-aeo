import * as Sentry from '@sentry/nextjs';
import { redactSensitiveRequestHeaders } from '@/lib/sentryPrivacy';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  sendDefaultPii: false,
  beforeSend: redactSensitiveRequestHeaders,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
