'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
} from 'lucide-react';
import { useAuthContext } from '@/context/AuthContext';
import { isPlausibleOpenRouterKey } from '@/lib/openRouterKey';
import ThemeToggle from '@/components/shared/ThemeToggle';

const providers = [
  { name: 'ChatGPT', model: 'GPT-5.4 mini', mark: 'O' },
  { name: 'Google', model: 'Gemini Flash', mark: 'G' },
  { name: 'Perplexity', model: 'Sonar Pro', mark: 'P' },
];

export default function Page(): React.ReactElement {
  const router = useRouter();
  const { user, saveOpenRouterKey } = useAuthContext();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [router, user]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!isPlausibleOpenRouterKey(apiKey)) {
      setError('Enter the API key from your OpenRouter account.');
      return;
    }

    setSaving(true);
    try {
      await saveOpenRouterKey(apiKey);
      router.replace('/dashboard');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The key could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-5 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <Image
            src="/genos-wordmark.png"
            alt="Genos"
            width={512}
            height={141}
            className="h-auto w-36 dark:brightness-0 dark:invert"
            priority
          />
          <ThemeToggle />
        </header>

        <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
          <section className="max-w-2xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 font-mono text-xs text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              LOCAL WORKSPACE
            </div>
            <h1 className="max-w-xl text-4xl font-semibold leading-[1.04] tracking-[-0.045em] sm:text-6xl">
              One key. Three views of the answer web.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
              Connect OpenRouter once to run the same buyer query through ChatGPT,
              Google, and Perplexity—then compare visibility and citations in one place.
            </p>

            <div className="mt-10 max-w-lg border-y border-border">
              {providers.map((provider, index) => (
                <div
                  key={provider.name}
                  className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 py-4 ${
                    index > 0 ? 'border-t border-border' : ''
                  }`}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card font-mono text-sm font-semibold">
                    {provider.mark}
                  </div>
                  <span className="font-medium">{provider.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{provider.model}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="relative">
            <div
              aria-hidden="true"
              className="absolute -inset-5 -z-10 rounded-[2.25rem] bg-primary/[0.06]"
            />
            <div className="rounded-[1.75rem] border border-border bg-card p-6 shadow-2xl shadow-slate-950/10 sm:p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <KeyRound className="h-5 w-5" />
              </div>
              <h2 className="mt-7 text-2xl font-semibold tracking-tight">Connect OpenRouter</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Your key stays in this browser. Genos sends it only with requests that
                need to reach OpenRouter.
              </p>

              <form onSubmit={handleSubmit} className="mt-7">
                <label htmlFor="openrouter-key" className="text-sm font-medium">
                  OpenRouter API key
                </label>
                <div className="relative mt-2">
                  <input
                    id="openrouter-key"
                    name="openrouter-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="sk-or-v1-…"
                    className="h-12 w-full rounded-xl border border-input bg-background px-4 py-3 pr-12 font-mono text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                    aria-describedby={error ? 'openrouter-key-error' : 'openrouter-key-note'}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((visible) => !visible)}
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground transition hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {error ? (
                  <p id="openrouter-key-error" role="alert" className="mt-2 text-sm text-destructive">
                    {error}
                  </p>
                ) : (
                  <p id="openrouter-key-note" className="mt-2 text-xs text-muted-foreground">
                    You can replace this key later from the profile icon.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={saving || !apiKey.trim()}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Opening workspace…' : 'Open local workspace'}
                  {!saving && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>

              <div className="mt-6 flex items-start gap-3 border-t border-border pt-5">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-5 text-muted-foreground">
                  No account, sign-in, or authentication emulator is used in local mode.
                  Clearing browser storage removes the saved key.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
