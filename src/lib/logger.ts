// Tiny logging shim. In development every level forwards to console; in
// production debug/info are dropped while warn/error still ship (so Sentry
// breadcrumbs and real failures still surface). Application code imports this
// shim; command-line scripts write directly to stdout/stderr for operators.

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
