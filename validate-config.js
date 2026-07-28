const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({
  path: [path.resolve('.env.local'), path.resolve('.env')],
  quiet: true,
});

const missing = [];

function isPlaceholder(value) {
  return /(^|[-_])your([-_]|$)|replace[_-]?with|example\.com|test-api-key/i.test(value);
}

function isConfigured(name) {
  const value = process.env[name]?.trim();
  return Boolean(value && !isPlaceholder(value));
}

if (!isConfigured('DATABASE_URL')) {
  missing.push('DATABASE_URL');
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

console.log('Genos local configuration check');
console.log(`${isConfigured('DATABASE_URL') ? 'OK' : 'MISSING'}  DATABASE_URL`);
console.log(
  `OpenRouter: browser key requested at runtime${
    isConfigured('OPENROUTER_API_KEY') ? '; server fallback configured' : ''
  }`
);

if (missing.length > 0) {
  console.error(`\nConfiguration incomplete: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nLocal configuration is ready.');
}
