export const OPENROUTER_KEY_STORAGE_KEY = 'genos.openrouter-api-key';
export const OPENROUTER_KEY_HEADER = 'x-openrouter-api-key';

export function normalizeOpenRouterKey(value: string): string {
  return value.trim();
}

export function isPlausibleOpenRouterKey(value: string): boolean {
  const key = normalizeOpenRouterKey(value);
  return key.length <= 512 && /^sk-or-v1-[A-Za-z0-9_-]{16,}$/.test(key);
}

export function getStoredOpenRouterKey(): string | null {
  if (typeof window === 'undefined') return null;
  const key = normalizeOpenRouterKey(
    window.localStorage.getItem(OPENROUTER_KEY_STORAGE_KEY) || ''
  );
  if (isPlausibleOpenRouterKey(key)) return key;
  if (key) window.localStorage.removeItem(OPENROUTER_KEY_STORAGE_KEY);
  return null;
}

export function storeOpenRouterKey(value: string): string {
  if (typeof window === 'undefined') {
    throw new Error('OpenRouter keys can only be stored in the browser');
  }

  const key = normalizeOpenRouterKey(value);
  if (!isPlausibleOpenRouterKey(key)) {
    throw new Error('Enter a valid OpenRouter API key');
  }

  window.localStorage.setItem(OPENROUTER_KEY_STORAGE_KEY, key);
  return key;
}

export function removeStoredOpenRouterKey(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(OPENROUTER_KEY_STORAGE_KEY);
}

export async function getOpenRouterKeyWithRetry(
  retries = 1,
  retryDelayMs = 100
): Promise<string | null> {
  const attempts = Math.max(1, Math.floor(retries));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const key = getStoredOpenRouterKey();
    if (key) return key;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return null;
}
