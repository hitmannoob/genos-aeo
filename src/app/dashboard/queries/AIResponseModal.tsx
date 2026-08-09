'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useBrandContext } from '@/context/BrandContext';
import {
  ChatGPTCitations,
  ChatGPTResponse,
} from '@/components/features/ChatGPTResponseRenderer';
import {
  GoogleAIOverviewCitations,
  GoogleAIOverviewResponse,
} from '@/components/features/GoogleAIOverviewRenderer';
import PerplexityResponseRenderer from '@/components/features/PerplexityResponseRenderer';
import { analyzeBrandMentions } from '@/lib/brand-mentions';
import {
  citationsForChatGPT,
  citationsForGoogle,
  citationsForPerplexity,
} from '@/lib/citations/stored';
import {
  getCanonicalGoogleResult,
  getGoogleResultText,
  type GoogleAIStoredResult,
  type QueryProcessingResult,
} from '@/lib/queryResultUtils';

type ProviderTab = 'chatgpt' | 'google' | 'perplexity';
type DetailTab = 'response' | 'citations';

const PROVIDER_LABELS: Record<ProviderTab, string> = {
  chatgpt: 'ChatGPT',
  google: 'Google AI Overview',
  perplexity: 'Perplexity',
};

const PROVIDER_ACCENTS: Record<ProviderTab, string> = {
  chatgpt: 'bg-green-500',
  google: 'bg-blue-500',
  perplexity: 'bg-purple-500',
};

interface AIResponseModalProps {
  selectedQuery: QueryProcessingResult;
  onClose: () => void;
}

function ErrorNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
      This provider failed to return a response: {message}
    </div>
  );
}

export default function AIResponseModal({ selectedQuery, onClose }: AIResponseModalProps) {
  const { selectedBrand } = useBrandContext();
  const [activeProvider, setActiveProvider] = useState<ProviderTab>('chatgpt');
  const [activeDetail, setActiveDetail] = useState<DetailTab>('response');

  const googleSource = getCanonicalGoogleResult(selectedQuery.results);
  const googleText = getGoogleResultText(googleSource);
  const googleResult: GoogleAIStoredResult | undefined = googleSource
    ? {
        ...googleSource,
        aiOverview: googleText,
        hasAIOverview: Boolean(googleText),
      }
    : undefined;

  const availableProviders = useMemo<ProviderTab[]>(() => {
    const providers: ProviderTab[] = [];
    if (selectedQuery.results.chatgpt) providers.push('chatgpt');
    if (googleSource) providers.push('google');
    if (selectedQuery.results.perplexity) providers.push('perplexity');
    return providers;
  }, [googleSource, selectedQuery.results.chatgpt, selectedQuery.results.perplexity]);

  useEffect(() => {
    if (!availableProviders.includes(activeProvider) && availableProviders[0]) {
      setActiveProvider(availableProviders[0]);
    }
  }, [activeProvider, availableProviders]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const brandName = selectedBrand?.companyName ?? '';
  const brandDomain = selectedBrand?.domain ?? '';
  const competitors = selectedBrand?.competitors ?? [];
  const highlightTerms = useMemo(
    () => [brandName, ...competitors].filter((term) => term.trim().length > 0),
    [brandName, competitors]
  );

  const chatgptCitations = useMemo(
    () => citationsForChatGPT(selectedQuery.results.chatgpt),
    [selectedQuery.results.chatgpt]
  );
  const googleCitations = useMemo(
    () => citationsForGoogle(googleResult),
    [googleResult]
  );
  const perplexityCitations = useMemo(
    () => citationsForPerplexity(selectedQuery.results.perplexity),
    [selectedQuery.results.perplexity]
  );

  const analysis = useMemo(() => analyzeBrandMentions(
    brandName,
    brandDomain,
    {
      chatgpt: selectedQuery.results.chatgpt
        ? { response: selectedQuery.results.chatgpt.response, citations: chatgptCitations }
        : undefined,
      googleAI: googleResult
        ? { aiOverview: googleText, citations: googleCitations }
        : undefined,
      perplexity: selectedQuery.results.perplexity
        ? { response: selectedQuery.results.perplexity.response, citations: perplexityCitations }
        : undefined,
    },
    competitors
  ), [
    brandDomain,
    brandName,
    chatgptCitations,
    competitors,
    googleCitations,
    googleResult,
    googleText,
    perplexityCitations,
    selectedQuery.results.chatgpt,
    selectedQuery.results.perplexity,
  ]);

  const citationCounts: Record<ProviderTab, number> = {
    chatgpt: chatgptCitations.length,
    google: googleCitations.length,
    perplexity: perplexityCitations.length,
  };

  const providerAnalysis = activeProvider === 'google'
    ? analysis.results.google
    : analysis.results[activeProvider];

  const renderProviderContent = () => {
    if (activeProvider === 'chatgpt') {
      const result = selectedQuery.results.chatgpt;
      if (!result) return null;
      return (
        <>
          <ErrorNotice message={result.error} />
          {activeDetail === 'response'
            ? <ChatGPTResponse response={result.response} webSearchUsed={result.webSearchUsed} highlightTerms={highlightTerms} />
            : <ChatGPTCitations response={result.response} citations={chatgptCitations} />}
        </>
      );
    }

    if (activeProvider === 'google') {
      if (!googleResult) return null;
      return (
        <>
          <ErrorNotice message={googleResult.error} />
          {activeDetail === 'response'
            ? <GoogleAIOverviewResponse googleAIData={googleResult} highlightTerms={highlightTerms} />
            : <GoogleAIOverviewCitations googleAIData={{ ...googleResult, citationData: googleCitations }} />}
        </>
      );
    }

    const result = selectedQuery.results.perplexity;
    if (!result) return null;
    return (
      <>
        <ErrorNotice message={result.error} />
        <PerplexityResponseRenderer
          data={{ ...result, citationData: perplexityCitations }}
          activeTab={activeDetail}
          highlightTerms={highlightTerms}
        />
      </>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-response-title"
      >
        <header className="flex shrink-0 items-start justify-between border-b border-border bg-card px-6 py-5">
          <div className="min-w-0 pr-4">
            <h2 id="ai-response-title" className="line-clamp-2 text-xl font-bold text-foreground">
              “{selectedQuery.query}”
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Stored AI-provider responses and their source citations</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close response details"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <section className="shrink-0 border-b border-border bg-muted/40 px-6 py-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Brand and citation analysis</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['Brand mentions', analysis.totals.totalBrandMentions, 'text-blue-700 dark:text-blue-300'],
              ['Brand citations', analysis.totals.totalDomainCitations, 'text-green-700 dark:text-green-300'],
              ['All citations', analysis.totals.totalCitations, 'text-purple-700 dark:text-purple-300'],
              ['Competitor mentions', analysis.totals.totalCompetitorMentions, 'text-orange-700 dark:text-orange-300'],
              ['Providers mentioning brand', `${analysis.totals.providersWithBrandMention}/${availableProviders.length}`, 'text-pink-700 dark:text-pink-300'],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                <div className={`text-xl font-bold ${color}`}>{value}</div>
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex shrink-0 overflow-x-auto overflow-y-hidden border-b border-border" role="tablist" aria-label="AI providers">
          {availableProviders.map((provider) => {
            const result = provider === 'google' ? analysis.results.google : analysis.results[provider];
            return (
              <button
                key={provider}
                type="button"
                role="tab"
                aria-selected={activeProvider === provider}
                onClick={() => {
                  setActiveProvider(provider);
                  setActiveDetail('response');
                }}
                className={`flex min-w-fit items-center gap-2 border-b-2 px-6 py-4 text-sm font-semibold transition-colors ${
                  activeProvider === provider
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${PROVIDER_ACCENTS[provider]}`} />
                {PROVIDER_LABELS[provider]}
                {result?.brandMentioned && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950/60 dark:text-green-300">Brand found</span>
                )}
              </button>
            );
          })}
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto bg-background p-6">
          {availableProviders.length === 0 ? (
            <div className="py-12 text-center">
              <h3 className="text-lg font-semibold text-foreground">No provider results available</h3>
              <p className="mt-2 text-sm text-muted-foreground">This query has no stored provider response.</p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-center justify-between border-b border-border">
                <div className="flex" role="tablist" aria-label={`${PROVIDER_LABELS[activeProvider]} details`}>
                  {(['response', 'citations'] as const).map((detail) => (
                    <button
                      key={detail}
                      type="button"
                      role="tab"
                      aria-selected={activeDetail === detail}
                      onClick={() => setActiveDetail(detail)}
                      className={`border-b-2 px-5 py-3 text-sm font-medium capitalize ${
                        activeDetail === detail
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {detail}{detail === 'citations' ? ` (${citationCounts[activeProvider]})` : ''}
                    </button>
                  ))}
                </div>
                {providerAnalysis && (
                  <div className="hidden gap-3 text-xs text-muted-foreground sm:flex">
                    <span>{providerAnalysis.brandMentionCount} brand mentions</span>
                    <span>{providerAnalysis.domainCitationCount} brand citations</span>
                  </div>
                )}
              </div>
              {renderProviderContent()}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
