/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.20.242:3000', 'localhost:3000'],

  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },

  poweredByHeader: false,

}

// Sentry webpack plugin options.
// Kept minimal on purpose: no source-map upload yet.
// TODO: When deployment is wired up, add `authToken`, `org`, and `project`
// here (typically sourced from SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT
// env vars) so that releases and source maps can be uploaded to Sentry.
// See: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
const sentryWebpackPluginOptions = {
  // Suppresses Sentry SDK build-time logs. Set to false to see upload logs.
  silent: true,
};

const sentryBuildOptions = {
  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Hide source maps from the browser network tab
  hideSourceMaps: true,

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,
};

let exportedConfig = nextConfig;

try {
  // Lazy-require so the app still builds if @sentry/nextjs is not installed yet.
  // After `npm install`, this wraps the config with Sentry's build hooks.
  const { withSentryConfig } = require('@sentry/nextjs');
  exportedConfig = withSentryConfig(
    nextConfig,
    sentryWebpackPluginOptions,
    sentryBuildOptions
  );
} catch {
  // @sentry/nextjs not installed yet — fall back to the raw Next config.
  // This keeps `npm run dev` / `npm run build` working before `npm install`.
}

module.exports = exportedConfig;
