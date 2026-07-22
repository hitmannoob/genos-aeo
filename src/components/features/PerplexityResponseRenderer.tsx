'use client';

import CitationList from '@/components/shared/CitationList';
import SafeMarkdown from '@/components/shared/SafeMarkdown';
import { extractPerplexityCitations, type PerplexityData } from '@/lib/citations/perplexity';
import type { Citation } from '@/lib/citations/types';

export { extractPerplexityCitations };

interface StoredPerplexityData extends PerplexityData {
  citationData?: Citation[];
}

interface PerplexityResponseRendererProps {
  data: StoredPerplexityData;
  activeTab?: 'response' | 'citations';
  highlightTerms?: string[];
}

export function PerplexityMarkdownRenderer({ content, highlightTerms }: { content: string; highlightTerms?: string[] }) {
  return <SafeMarkdown content={content} accent="purple" highlightTerms={highlightTerms} />;
}

export function PerplexityCitations({ data }: { data: StoredPerplexityData }) {
  const citations = Array.isArray(data.citationData)
    ? data.citationData
    : extractPerplexityCitations(data.response || '', data);
  return <CitationList title="Perplexity sources and citations" citations={citations} accent="purple" />;
}

export default function PerplexityResponseRenderer({
  data,
  activeTab = 'response',
  highlightTerms,
}: PerplexityResponseRendererProps) {
  if (!data) {
    return (
      <div className="py-12 text-center">
        <h3 className="mb-2 text-lg font-semibold text-foreground">Perplexity response unavailable</h3>
        <p className="text-muted-foreground">No Perplexity result was returned for this query.</p>
      </div>
    );
  }

  if (activeTab === 'citations') return <PerplexityCitations data={data} />;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-purple-500" />
            <span className="text-sm font-semibold text-foreground">Perplexity response</span>
          </div>
          {data.realTimeData && <span className="text-sm font-semibold text-green-700">Real-time data</span>}
          {data.responseTime !== undefined && (
            <span className="text-sm font-semibold text-blue-700">{data.responseTime} ms</span>
          )}
        </div>
      </div>
      <div className="p-6">
        <SafeMarkdown content={data.response || 'No response available'} accent="purple" highlightTerms={highlightTerms} />
      </div>
    </div>
  );
}
