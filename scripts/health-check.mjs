import process from 'node:process';

const url = process.argv[2] || process.env.HEALTHCHECK_URL || 'http://127.0.0.1:3000/';
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5_000);

try {
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'manual',
    signal: controller.signal,
  });
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`HTTP ${response.status}`);
  }
  console.log(`Healthy: ${url} (${response.status})`);
} catch (error) {
  console.error(`Unhealthy: ${url} (${error instanceof Error ? error.message : 'request failed'})`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
