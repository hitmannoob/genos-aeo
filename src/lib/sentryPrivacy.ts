const SENSITIVE_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-admin-secret',
  'x-openrouter-api-key',
  'x-service-api-secret',
]);

interface SentryEventWithRequest {
  request?: {
    headers?: Record<string, string>;
  };
}

export function redactSensitiveRequestHeaders<T extends SentryEventWithRequest>(event: T): T {
  const headers = event.request?.headers;
  if (!headers) return event;

  for (const name of Object.keys(headers)) {
    if (SENSITIVE_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers[name] = '[Filtered]';
    }
  }

  return event;
}
