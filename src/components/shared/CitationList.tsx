'use client';

import WebLogo from '@/components/shared/WebLogo';
import type { Citation } from '@/lib/citations/types';

type Accent = 'blue' | 'green' | 'purple';

const CLASSES: Record<Accent, { dot: string; badge: string; card: string; link: string }> = {
  blue: {
    dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    card: 'border-blue-100 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40',
    link: 'text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200',
  },
  green: {
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
    card: 'border-green-100 bg-green-50 dark:border-green-900 dark:bg-green-950/40',
    link: 'text-green-600 hover:text-green-800 dark:text-green-300 dark:hover:text-green-200',
  },
  purple: {
    dot: 'bg-purple-500',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
    card: 'border-purple-100 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/40',
    link: 'text-purple-600 hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200',
  },
};

function safeCitation(citation: Citation): Citation | null {
  try {
    const url = new URL(citation.url);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username
      || url.password
    ) return null;
    return { ...citation, url: url.toString() };
  } catch {
    return null;
  }
}

export default function CitationList({
  title,
  citations,
  accent,
}: {
  title: string;
  citations: Citation[];
  accent: Accent;
}) {
  const classes = CLASSES[accent];
  const safeCitations = citations.map(safeCitation).filter((item): item is Citation => item !== null);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${classes.dot}`} />
          <span className="text-sm font-semibold text-foreground">{title} ({safeCitations.length})</span>
        </div>
      </div>
      <div className="p-6">
        {safeCitations.length > 0 ? (
          <div className="space-y-3">
            {safeCitations.map((citation, index) => (
              <div key={`${citation.url}-${index}`} className={`flex items-start gap-3 rounded-lg border p-3 ${classes.card}`}>
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${classes.badge}`}>
                  {index + 1}
                </div>
                <WebLogo domain={citation.url} className="h-[18px] w-[18px] shrink-0" size={18} />
                <div className="min-w-0 flex-1">
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block truncate text-sm font-medium ${classes.link}`}
                    title={citation.text}
                  >
                    {citation.text}
                  </a>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{citation.url}</p>
                  {(citation.source || citation.type) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[citation.source, citation.type?.replaceAll('-', ' ')].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <h3 className="mb-2 text-sm font-medium text-foreground">No citations found</h3>
            <p className="text-xs text-muted-foreground">This response did not include structured web references.</p>
          </div>
        )}
      </div>
    </div>
  );
}
