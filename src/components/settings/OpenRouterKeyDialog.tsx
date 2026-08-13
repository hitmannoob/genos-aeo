'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { useAuthContext } from '@/context/AuthContext';
import { isPlausibleOpenRouterKey } from '@/lib/openRouterKey';

interface OpenRouterKeyDialogProps {
  open: boolean;
  onClose?: () => void;
  required?: boolean;
}

export default function OpenRouterKeyDialog({
  open,
  onClose,
  required = false,
}: OpenRouterKeyDialogProps): React.ReactElement | null {
  const { openRouterKey, saveOpenRouterKey } = useAuthContext();
  const [nextKey, setNextKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setNextKey('');
    setShowKey(false);
    setSaved(false);
    setError(null);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 50);
    const handleEscape = (event: KeyboardEvent) => {
      if (!required && event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose, open, required]);

  if (!open) return null;

  const keySuffix = openRouterKey?.slice(-4) || '';

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!isPlausibleOpenRouterKey(nextKey)) {
      setError('Enter the API key from your OpenRouter account.');
      return;
    }

    setSaving(true);
    try {
      await saveOpenRouterKey(nextKey);
      setNextKey('');
      setSaved(true);
      if (required) onClose?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The key could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      {required ? (
        <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" />
      ) : (
        <button
          type="button"
          aria-label="Close API key settings"
          className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="openrouter-dialog-title"
        className="relative w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl"
      >
        {!required && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <KeyRound className="h-5 w-5" />
        </div>
        <h2 id="openrouter-dialog-title" className="mt-5 text-xl font-semibold tracking-tight">
          {keySuffix ? 'OpenRouter key' : 'Connect OpenRouter'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          One key powers the ChatGPT, Google, and Perplexity requests. It stays
          in this browser and is not saved to your Genos account.
        </p>

        <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-muted/60 px-4 py-3">
          <span className="text-sm text-muted-foreground">Current key</span>
          <span className="font-mono text-sm text-foreground">
            {keySuffix ? `••••••••${keySuffix}` : 'Not configured'}
          </span>
        </div>

        <form onSubmit={handleSave} className="mt-5">
          <label htmlFor="replacement-openrouter-key" className="text-sm font-medium">
            {keySuffix ? 'New API key' : 'OpenRouter API key'}
          </label>
          <div className="relative mt-2">
            <input
              ref={inputRef}
              id="replacement-openrouter-key"
              type={showKey ? 'text' : 'password'}
              value={nextKey}
              onChange={(event) => {
                setNextKey(event.target.value);
                setSaved(false);
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="sk-or-v1-…"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 pr-12 font-mono text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              aria-describedby={error ? 'replacement-key-error' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowKey((visible) => !visible)}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error && (
            <p id="replacement-key-error" role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {saved && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-primary">
              <Check className="h-4 w-4" />
              Key updated for future requests.
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            {!required && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
              >
                Close
              </button>
            )}
            <button
              type="submit"
              disabled={saving || !nextKey.trim()}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : keySuffix ? 'Save new key' : 'Save and continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
