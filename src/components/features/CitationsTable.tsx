'use client'
import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowUpDown,
  ExternalLink,
  Search,
  Eye,
  Lightbulb,
  TrendingUp,
  ShoppingCart,
} from 'lucide-react';
import WebLogo from '@/components/shared/WebLogo';

interface Citation {
  id: string;
  url: string;
  text: string;
  source: string;
  provider: 'chatgpt' | 'perplexity' | 'googleAI';
  query: string;
  queryId: string;
  brandName: string;
  domain?: string;
  timestamp: string;
  type?: string;
  isBrandMention?: boolean;
  isDomainCitation?: boolean;
}

interface BrandQuery {
  query: string;
  keyword: string;
  category: 'Awareness' | 'Interest' | 'Consideration' | 'Purchase' | string;
}

interface CitationsTableProps {
  citations: Citation[];
  queries?: BrandQuery[];
}

const INTENTS = ['Awareness', 'Interest', 'Consideration', 'Purchase'] as const;

const getIntentIcon = (category?: string) => {
  switch (category) {
    case 'Awareness': return <Eye className="h-3 w-3" />;
    case 'Interest': return <Lightbulb className="h-3 w-3" />;
    case 'Consideration': return <TrendingUp className="h-3 w-3" />;
    case 'Purchase': return <ShoppingCart className="h-3 w-3" />;
    default: return null;
  }
};

const getIntentColor = (category?: string) => {
  switch (category) {
    case 'Awareness': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Interest': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'Consideration': return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'Purchase': return 'bg-green-100 text-green-700 border-green-200';
    default: return 'bg-muted text-muted-foreground border-border';
  }
};

const truncate = (s: string, n = 60) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

export default function CitationsTable({ citations, queries = [] }: CitationsTableProps) {
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sortField, setSortField] = useState<keyof Citation>('timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedPrompt, setSelectedPrompt] = useState<string>('all');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [selectedIntents, setSelectedIntents] = useState<Set<string>>(new Set());
  const [filterBrandMention, setFilterBrandMention] = useState(false);
  const [filterDomainCitation, setFilterDomainCitation] = useState(false);

  // Lookup map: query text → { keyword, category }. Citations don't carry topic/intent,
  // so we join on the prompt text against the brand's configured queries at render time.
  const queryMeta = useMemo(() => {
    const map = new Map<string, { keyword: string; category: string }>();
    for (const q of queries) {
      if (q?.query) map.set(q.query, { keyword: q.keyword || '', category: q.category || '' });
    }
    return map;
  }, [queries]);

  const metaFor = (citationQuery: string) => queryMeta.get(citationQuery);

  // Unique prompt / topic options (derived from the citation set itself, not all brand queries,
  // so filters only show values the user can actually match).
  const promptOptions = useMemo(() => {
    const seen = new Set<string>();
    citations.forEach(c => c.query && seen.add(c.query));
    return Array.from(seen).sort();
  }, [citations]);

  const topicOptions = useMemo(() => {
    const seen = new Set<string>();
    citations.forEach(c => {
      const m = metaFor(c.query);
      if (m?.keyword) seen.add(m.keyword);
    });
    return Array.from(seen).sort();
  }, [citations, queryMeta]);

  const toggleIntent = (intent: string) => {
    setSelectedIntents(prev => {
      const next = new Set(prev);
      if (next.has(intent)) next.delete(intent);
      else next.add(intent);
      return next;
    });
    setPage(1);
  };

  // Filter
  const filteredCitations = citations.filter(citation => {
    if (selectedProvider !== 'all' && citation.provider !== selectedProvider) return false;
    if (filterBrandMention && !citation.isBrandMention) return false;
    if (filterDomainCitation && !citation.isDomainCitation) return false;
    if (selectedPrompt !== 'all' && citation.query !== selectedPrompt) return false;

    const meta = metaFor(citation.query);
    if (selectedTopic !== 'all' && (meta?.keyword || '') !== selectedTopic) return false;
    if (selectedIntents.size > 0 && !selectedIntents.has(meta?.category || '')) return false;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      if (
        !citation.text.toLowerCase().includes(term) &&
        !citation.url.toLowerCase().includes(term) &&
        !citation.query.toLowerCase().includes(term) &&
        !citation.source.toLowerCase().includes(term) &&
        !(citation.domain?.toLowerCase().includes(term))
      ) return false;
    }
    return true;
  });

  // Sort
  const sortedCitations = [...filteredCitations].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      const comparison = aValue.localeCompare(bValue);
      return sortDirection === 'asc' ? comparison : -comparison;
    }
    return 0;
  });

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sortedCitations.length / itemsPerPage));
  const clampedPage = Math.min(page, totalPages);
  const startIndex = (clampedPage - 1) * itemsPerPage;
  const paginatedCitations = sortedCitations.slice(startIndex, startIndex + itemsPerPage);

  const handleSort = (field: keyof Citation) => {
    if (sortField === field) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('desc'); }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedProvider('all');
    setSelectedPrompt('all');
    setSelectedTopic('all');
    setSelectedIntents(new Set());
    setFilterBrandMention(false);
    setFilterDomainCitation(false);
    setPage(1);
  };

  const hasActiveFilters =
    !!searchTerm ||
    selectedProvider !== 'all' ||
    selectedPrompt !== 'all' ||
    selectedTopic !== 'all' ||
    selectedIntents.size > 0 ||
    filterBrandMention ||
    filterDomainCitation;

  return (
    <div className="space-y-4">
      {/* Filter row 1: search, platform, prompt, topic */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search citations…"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            className="pl-10 pr-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <select
          value={selectedProvider}
          onChange={(e) => { setSelectedProvider(e.target.value); setPage(1); }}
          className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
        >
          <option value="all">All Platforms</option>
          <option value="chatgpt">ChatGPT</option>
          <option value="perplexity">Perplexity</option>
          <option value="googleAI">Google AI</option>
        </select>

        <select
          value={selectedPrompt}
          onChange={(e) => { setSelectedPrompt(e.target.value); setPage(1); }}
          className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground max-w-xs truncate"
          title={selectedPrompt === 'all' ? 'All prompts' : selectedPrompt}
        >
          <option value="all">All Prompts</option>
          {promptOptions.map(p => (
            <option key={p} value={p}>{truncate(p, 60)}</option>
          ))}
        </select>

        {topicOptions.length > 0 && (
          <select
            value={selectedTopic}
            onChange={(e) => { setSelectedTopic(e.target.value); setPage(1); }}
            className="px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
          >
            <option value="all">All Topics</option>
            {topicOptions.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        <label className="flex items-center space-x-1 text-sm text-foreground">
          <input
            type="checkbox"
            checked={filterBrandMention}
            onChange={e => { setFilterBrandMention(e.target.checked); setPage(1); }}
            className="accent-primary"
          />
          <span>Brand Mentioned</span>
        </label>

        <label className="flex items-center space-x-1 text-sm text-foreground">
          <input
            type="checkbox"
            checked={filterDomainCitation}
            onChange={e => { setFilterDomainCitation(e.target.checked); setPage(1); }}
            className="accent-primary"
          />
          <span>Domain Cited</span>
        </label>

        <div className="ml-auto flex items-center space-x-2">
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear filters
            </button>
          )}
          <span className="text-sm text-muted-foreground">Show</span>
          <select
            value={itemsPerPage}
            onChange={(e) => { setItemsPerPage(Number(e.target.value)); setPage(1); }}
            className="px-2 py-1 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span className="text-sm text-muted-foreground">per page</span>
        </div>
      </div>

      {/* Filter row 2: intent pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground mr-1">Intent:</span>
        {INTENTS.map(intent => {
          const active = selectedIntents.has(intent);
          return (
            <button
              key={intent}
              onClick={() => toggleIntent(intent)}
              className={`inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                active ? getIntentColor(intent) : 'bg-background text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              {getIntentIcon(intent)}
              <span>{intent}</span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="min-w-[1200px] w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer" onClick={() => handleSort('source')}>
                <div className="flex items-center space-x-1"><span>Source</span><ArrowUpDown className="h-4 w-4" /></div>
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer" onClick={() => handleSort('query')}>
                <div className="flex items-center space-x-1"><span>Prompt</span><ArrowUpDown className="h-4 w-4" /></div>
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Topic</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Intent</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Citation</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer" onClick={() => handleSort('provider')}>
                <div className="flex items-center space-x-1"><span>Platform</span><ArrowUpDown className="h-4 w-4" /></div>
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer" onClick={() => handleSort('timestamp')}>
                <div className="flex items-center space-x-1"><span>Date</span><ArrowUpDown className="h-4 w-4" /></div>
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-border">
            {paginatedCitations.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-sm text-muted-foreground">
                  No citations match the current filters.
                </td>
              </tr>
            ) : paginatedCitations.map((citation) => {
              const meta = metaFor(citation.query);
              const topic = meta?.keyword || '';
              const intent = meta?.category || '';
              return (
                <tr key={citation.id} className="hover:bg-muted/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-3">
                      {citation.domain && (
                        <WebLogo domain={`https://${citation.domain}`} className="w-6 h-6" size={24} />
                      )}
                      <div>
                        <div className="font-medium text-foreground">{citation.source}</div>
                        {citation.domain && (
                          <div className="text-sm text-muted-foreground">{citation.domain}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-sm text-foreground max-w-[340px] truncate" title={citation.query}>
                      {citation.query ? truncate(citation.query, 60) : <span className="text-muted-foreground">—</span>}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-sm whitespace-nowrap">
                    {topic ? (
                      <span className="text-foreground">{topic}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {intent ? (
                      <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${getIntentColor(intent)}`}>
                        {getIntentIcon(intent)}
                        <span>{intent}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="max-w-xl">
                      <p className="text-sm text-foreground line-clamp-2">{citation.text}</p>
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:text-primary/80 flex items-center space-x-1 mt-1"
                      >
                        <span className="truncate max-w-md">{citation.url}</span>
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                      ${citation.provider === 'chatgpt' ? 'bg-green-100 text-green-800' :
                      citation.provider === 'perplexity' ? 'bg-purple-100 text-purple-800' :
                      'bg-blue-100 text-blue-800'}`}
                    >
                      {citation.provider === 'chatgpt' ? 'ChatGPT' :
                       citation.provider === 'perplexity' ? 'Perplexity' : 'Google AI'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                    {format(new Date(citation.timestamp), 'MMM d, yyyy')}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex flex-col gap-1">
                      {citation.isBrandMention && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          Brand Mentioned
                        </span>
                      )}
                      {citation.isDomainCitation && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          Domain Cited
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {sortedCitations.length === 0 ? 0 : startIndex + 1} to {Math.min(startIndex + itemsPerPage, sortedCitations.length)} of {sortedCitations.length} results
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setPage(Math.max(1, clampedPage - 1))}
            disabled={clampedPage === 1}
            className="px-3 py-1 border border-border rounded-lg disabled:opacity-50 hover:bg-muted transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            Page {clampedPage} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, clampedPage + 1))}
            disabled={clampedPage === totalPages}
            className="px-3 py-1 border border-border rounded-lg disabled:opacity-50 hover:bg-muted transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
