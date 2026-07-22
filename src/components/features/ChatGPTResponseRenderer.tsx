'use client';

import CitationList from '@/components/shared/CitationList';
import SafeMarkdown from '@/components/shared/SafeMarkdown';
import { extractChatGPTCitations } from '@/lib/citations/chatgpt';
import type { Citation } from '@/lib/citations/types';

export { extractChatGPTCitations };

interface ChatGPTResponseProps {
  response: string;
  webSearchUsed?: boolean;
  highlightTerms?: string[];
}

export function ChatGPTResponse({ response, webSearchUsed, highlightTerms }: ChatGPTResponseProps) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-sm font-semibold text-foreground">ChatGPT response</span>
          </div>
          {typeof webSearchUsed === 'boolean' && (
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${webSearchUsed ? 'bg-blue-500' : 'bg-gray-400'}`} />
              <span className="text-sm font-semibold text-foreground">
                {webSearchUsed ? 'Web search used' : 'Web search not used'}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="p-6">
        <SafeMarkdown content={response || 'No response available'} accent="green" highlightTerms={highlightTerms} />
      </div>
    </div>
  );
}

export function ChatGPTCitations({
  response,
  citations,
}: {
  response: string;
  citations?: Citation[];
}) {
  return (
    <CitationList
      title="ChatGPT web references"
      citations={citations ?? extractChatGPTCitations(response || '')}
      accent="green"
    />
  );
}
