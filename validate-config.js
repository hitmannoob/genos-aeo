const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({
  path: [path.resolve('.env.local'), path.resolve('.env')],
  quiet: true,
});

const required = [
  'DATABASE_URL',
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

function isPlaceholder(value) {
  return /(^|[-_])your([-_]|$)|replace[_-]?with|YOUR_PRIVATE_KEY|example\.com|test-api-key|test-project/i
    .test(value);
}

function isConfigured(name) {
  const value = process.env[name]?.trim();
  return Boolean(value && !isPlaceholder(value));
}

const clientUsesAuthEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
const serverAuthEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const optionalOpenRouterKey = process.env.OPENROUTER_API_KEY?.trim();
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction || !serverAuthEmulatorHost) {
  required.push('FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY');
}

const missing = required.filter((name) => !isConfigured(name));

if (isProduction) {
  if (clientUsesAuthEmulator || serverAuthEmulatorHost) {
    missing.push('Firebase Auth emulator variables must be disabled in production');
  }
}

for (const secretName of ['SERVICE_API_SECRET', 'ADMIN_API_SECRET']) {
  const value = process.env[secretName]?.trim();
  if (value && (value.length < 32 || isPlaceholder(value))) {
    missing.push(`${secretName} (must be a non-placeholder secret of at least 32 characters)`);
  }
}
if (
  process.env.SERVICE_API_SECRET?.trim()
  && process.env.SERVICE_API_SECRET.trim() === process.env.ADMIN_API_SECRET?.trim()
) {
  missing.push('SERVICE_API_SECRET and ADMIN_API_SECRET must be different');
}
if (clientUsesAuthEmulator && !serverAuthEmulatorHost) {
  missing.push('FIREBASE_AUTH_EMULATOR_HOST (required when the client emulator is enabled)');
}
if (
  serverAuthEmulatorHost
  && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(serverAuthEmulatorHost)
) {
  missing.push('FIREBASE_AUTH_EMULATOR_HOST must use a loopback host and explicit port');
}
if (
  optionalOpenRouterKey
  && !/^sk-or-v1-[A-Za-z0-9_-]{16,}$/.test(optionalOpenRouterKey)
) {
  missing.push('OPENROUTER_API_KEY must be a current OpenRouter API key when configured');
}

try {
  const databaseUrl = new URL(process.env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    missing.push('DATABASE_URL must use the postgres or postgresql scheme');
  }
  const localDatabase = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
  if (!localDatabase && process.env.POSTGRES_SSL !== 'true') {
    missing.push('POSTGRES_SSL=true is required for a non-local database');
  }
  if (!localDatabase && process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === 'false') {
    missing.push('POSTGRES_SSL_REJECT_UNAUTHORIZED must not be false for a non-local database');
  }
} catch {
  if (process.env.DATABASE_URL?.trim()) {
    missing.push('DATABASE_URL is not a valid URL');
  }
}

console.log('Genos configuration check');
for (const name of required) {
  console.log(`${missing.includes(name) ? 'MISSING' : 'OK'}  ${name}`);
}

console.log(
  `\nOpenRouter: browser key required at runtime${
    isConfigured('OPENROUTER_API_KEY') ? '; trusted-service fallback configured' : ''
  }`
);

if (missing.length > 0) {
  console.error(`\nConfiguration incomplete: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nConfiguration is ready.');
}
