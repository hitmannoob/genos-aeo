// Tiny logging shim. In development every level forwards to console; in
// production debug/info are dropped while warn/error still ship (so Sentry
// breadcrumbs and real failures still surface). New code should import
// from here instead of calling console.* directly.
//
// Existing console.* calls are intentionally left in place for now —
// migrating them is a follow-up. Use this for any new logging.

const isProd = process.env.NODE_ENV === 'production';

export const logger = {
  debug: (...args: unknown[]): void => {
    if (!isProd) console.debug(...args);
  },
  info: (...args: unknown[]): void => {
    if (!isProd) console.info(...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};
