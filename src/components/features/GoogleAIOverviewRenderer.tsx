'use client';

import CitationList from '@/components/shared/CitationList';
import SafeMarkdown from '@/components/shared/SafeMarkdown';
import { extractGoogleAIOverviewCitations } from '@/lib/citations/googleAIOverview';
import type { Citation } from '@/lib/citations/types';

export { extractGoogleAIOverviewCitations };

interface GoogleAIOverviewData {
  aiOverview?: string;
  hasAIOverview?: boolean;
  citationData?: Citation[];
}

export function GoogleAIOverviewResponse({
  googleAIData,
  highlightTerms,
}: {
  googleAIData: GoogleAIOverviewData;
  highlightTerms?: string[];
}) {
  const hasOverview = Boolean(googleAIData?.hasAIOverview || googleAIData?.aiOverview);
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${hasOverview ? 'bg-blue-500' : 'bg-gray-400'}`} />
          <span className="text-sm font-semibold text-foreground">Google AI Overview</span>
        </div>
      </div>
      <div className="p-6">
        <SafeMarkdown
          content={googleAIData?.aiOverview || 'No AI Overview was returned for this query.'}
          accent="blue"
          highlightTerms={highlightTerms}
        />
      </div>
    </div>
  );
}

export function GoogleAIOverviewCitations({ googleAIData }: { googleAIData: GoogleAIOverviewData }) {
  const citations = Array.isArray(googleAIData?.citationData)
    ? googleAIData.citationData
    : extractGoogleAIOverviewCitations(googleAIData?.aiOverview || '', googleAIData);
  return <CitationList title="Google AI Overview references" citations={citations} accent="blue" />;
}
