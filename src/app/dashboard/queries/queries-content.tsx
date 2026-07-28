'use client'
import React, { useState } from 'react';
import Link from 'next/link';
import { useBrandContext } from '@/context/BrandContext';
import DashboardLayout from '@/components/layout/DashboardLayout';
import QueriesOverview from '@/components/features/QueriesOverview';
import { useAuthContext } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import AIResponseModal from './AIResponseModal';
import WebLogo from '@/components/shared/WebLogo';
import {
  getCategoryAccentClasses,
  getCategorySolidClass,
} from '@/lib/queryCategories';
import type { QueryProcessingResult } from '@/lib/queryResultUtils';
import {
  Search,
  RefreshCw,
  AlertCircle,
  X
} from 'lucide-react';


export default function QueriesContent(): React.ReactElement {
  const { selectedBrand, brands, loading: brandLoading, refetchBrands } = useBrandContext();
  const { user } = useAuthContext();
  const { showSuccess, showError, showWarning } = useToast();
  const [showResults, setShowResults] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState<QueryProcessingResult | null>(null);
  
  
  // Add Query Modal State
  const [showAddQueryModal, setShowAddQueryModal] = useState(false);
  const [newQuery, setNewQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'Awareness' | 'Interest' | 'Consideration' | 'Purchase'>('Awareness');
  const [selectedTopic, setSelectedTopic] = useState<string>('');
  const [newTopicDraft, setNewTopicDraft] = useState<string>('');
  const [isCreatingNewTopic, setIsCreatingNewTopic] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState(false);

  // Existing topics = union of brand.keywords (from onboarding step-2) and
  // any keywords already in use on brand.queries — so custom topics added
  // later show up for re-use.
  const existingTopics: string[] = React.useMemo(() => {
    if (!selectedBrand) return [];
    const fromKeywords: string[] = Array.isArray(selectedBrand.keywords)
      ? selectedBrand.keywords
      : [];
    const fromQueries: string[] = Array.isArray(selectedBrand.queries)
      ? selectedBrand.queries
          .map((query) => query.keyword)
          .filter((keyword) => keyword.length > 0 && keyword !== 'custom')
      : [];
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const k of [...fromKeywords, ...fromQueries]) {
      const t = k.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    return merged;
  }, [selectedBrand]);

  const resetModal = () => {
    setNewQuery('');
    setSelectedCategory('Awareness');
    setSelectedTopic('');
    setNewTopicDraft('');
    setIsCreatingNewTopic(false);
  };

  const postBrandMutation = async (body: Record<string, unknown>) => {
    if (!selectedBrand) {
      throw new Error('No brand selected');
    }

    const response = await fetch(`/api/brands/${selectedBrand.id}/queries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || 'Request failed');
    }
  };

  // Add Query Modal Handlers
  const handleAddQuery = () => {
    // Pre-select the first existing topic if there is one; otherwise open the
    // "create new topic" path so the user isn't stuck.
    setSelectedTopic(existingTopics[0] ?? '');
    setIsCreatingNewTopic(existingTopics.length === 0);
    setShowAddQueryModal(true);
  };

  const resolveTopic = (): string => {
    if (isCreatingNewTopic) return newTopicDraft.trim();
    return selectedTopic.trim();
  };

  // Confirm the typed new-topic draft: register it on the brand now (so the
  // user sees it committed) and collapse the input back to the chip view.
  const handleConfirmNewTopic = async () => {
    const draft = newTopicDraft.trim();
    if (!draft || !selectedBrand) return;

    const existing = existingTopics.find(t => t.toLowerCase() === draft.toLowerCase());
    if (existing) {
      setSelectedTopic(existing);
      setIsCreatingNewTopic(false);
      setNewTopicDraft('');
      return;
    }

    try {
      await postBrandMutation({
        action: 'addKeyword',
        keyword: draft,
      });
      setSelectedTopic(draft);
      setIsCreatingNewTopic(false);
      setNewTopicDraft('');
      await refetchBrands().catch(() => {
        showWarning('Topic added', 'Reload the page to refresh the topic list.');
      });
    } catch (error) {
      showError(
        'Failed to add topic',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  const handleSaveQuery = async () => {
    const topic = resolveTopic();
    if (!newQuery.trim() || !selectedBrand || !user) {
      return;
    }
    if (!topic) {
      showError('Topic required', 'Pick an existing topic or create a new one.');
      return;
    }

    setIsSaving(true);

    try {
      // addQuery updates the query and its topic in one server transaction.
      const isNewTopic =
        isCreatingNewTopic &&
        !existingTopics.some(t => t.toLowerCase() === topic.toLowerCase());

      await postBrandMutation({
        action: 'addQuery',
        query: newQuery,
        category: selectedCategory,
        keyword: topic,
      });

      resetModal();
      setShowAddQueryModal(false);

      showSuccess(
        'Query added',
        isNewTopic
          ? `New topic "${topic}" created and query attached.`
          : 'Your new query is ready to process.'
      );
      await refetchBrands().catch(() => {
        showWarning('Query added', 'Reload the page to refresh the query list.');
      });
    } catch (error) {
      showError(
        'Failed to add query',
        error instanceof Error ? error.message : 'Please try again in a moment.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelQuery = () => {
    resetModal();
    setShowAddQueryModal(false);
  };

  const handleQueryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newQuery.trim()) {
      handleSaveQuery();
    } else if (e.key === 'Escape') {
      handleCancelQuery();
    }
  };

  // Show loading while brands are being fetched
  if (brandLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center space-x-2 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span>Loading brands...</span>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Show empty state if no brands
  if (brands.length === 0) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Brands Found</h3>
          <p className="text-muted-foreground mb-4">
            Add your first brand to start tracking queries.
          </p>
          <Link href="/dashboard/add-brand/step-1" className="rounded-lg bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90">
            Add Brand
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  // Show message if no brand is selected
  if (!selectedBrand) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Brand Selected</h3>
          <p className="text-muted-foreground">
            Please select a brand from the sidebar to view queries.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <WebLogo domain={selectedBrand.domain} size={40} />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Queries</h1>
              <p className="text-muted-foreground">for {selectedBrand.companyName}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleAddQuery}
              className="bg-primary/10 text-primary px-4 py-2 rounded-full hover:bg-primary/20 transition-colors"
            >
              Add Query
            </button>
          </div>
        </div>

        {/* Data Source Info Banner */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-primary rounded-full"></div>
            <div>
              <h3 className="font-semibold text-foreground">All Tracked Queries</h3>
              <p className="text-sm text-muted-foreground">
                Every query you're tracking for this brand, with the latest response from each AI provider. Click a row to inspect the full response and citations.
              </p>
            </div>
          </div>
        </div>

        {/* Reusable Queries Component */}
        <QueriesOverview
          variant="full"
          layout="table"
          showSearch={true}
          showProcessButton={true}
          showEyeIcons={true}
          onQueryClick={(query, result) => {
            if (result) {
              setSelectedQuery(result);
              setShowResults(true);
            }
          }}
          className="min-h-[400px]"
        />

        {/* AI Response Modal */}
        {showResults && selectedQuery && (
          <AIResponseModal 
            selectedQuery={selectedQuery}
            onClose={() => {
              setShowResults(false);
              setSelectedQuery(null);
            }}
          />
        )}

        {/* Add Query Modal */}
        {showAddQueryModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-query-title"
              className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-xl"
            >
              {/* Modal Header — fixed */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border/50 flex-shrink-0">
                <h3 id="add-query-title" className="text-lg font-semibold text-foreground">Add New Query</h3>
                <button
                  type="button"
                  onClick={handleCancelQuery}
                  aria-label="Close add-query form"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Content — scrollable */}
              <div className="space-y-6 overflow-y-auto px-6 py-5 flex-1 min-h-0">
                <p className="text-muted-foreground text-sm">
                  Add a new query to your list for tracking and analysis.
                </p>

                {/* Query Input */}
                <div>
                  <label htmlFor="new-query" className="block text-sm font-medium text-foreground mb-2">
                    Query
                  </label>
                  <input
                    id="new-query"
                    type="text"
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    onKeyDown={handleQueryKeyDown}
                    placeholder="e.g. what is the best tool for GEO? FYI it's Genos 😊"
                    className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
                    autoFocus
                  />
                </div>

                {/* Topic Selection */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Topic
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Pick an existing topic or create a new one. Topics group
                    queries together for analytics.
                  </p>

                  {!isCreatingNewTopic && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {existingTopics.map(topic => {
                        const selected = selectedTopic === topic;
                        return (
                          <button
                            key={topic}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setSelectedTopic(topic)}
                            className={`px-3 py-1.5 rounded-full text-sm border transition-colors max-w-full break-words text-left ${
                              selected
                                ? 'border-blue-300 bg-blue-50 text-blue-700'
                                : 'border-border hover:bg-muted/30'
                            }`}
                          >
                            {topic}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingNewTopic(true);
                          setSelectedTopic('');
                        }}
                        className="px-3 py-1.5 rounded-full text-sm border border-dashed border-border text-muted-foreground hover:bg-muted/30 transition-colors"
                      >
                        + Create new topic
                      </button>
                    </div>
                  )}

                  {isCreatingNewTopic && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          aria-label="New topic name"
                          value={newTopicDraft}
                          onChange={(e) => setNewTopicDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newTopicDraft.trim()) {
                              e.preventDefault();
                              void handleConfirmNewTopic();
                            }
                          }}
                          maxLength={50}
                          placeholder="e.g. LLM Observability"
                          className="flex-1 px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => void handleConfirmNewTopic()}
                          disabled={!newTopicDraft.trim()}
                          className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Add
                        </button>
                        {existingTopics.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsCreatingNewTopic(false);
                              setNewTopicDraft('');
                              setSelectedTopic(existingTopics[0] ?? '');
                            }}
                            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Press Enter or click Add to register this topic.
                      </p>
                    </div>
                  )}
                </div>

                {/* Category Selection */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">
                    Category
                  </label>
                  <div className="space-y-3">
                    {[
                      {
                        category: 'Awareness' as const,
                        description: 'Brand discovery, "What is [brand]?", company mentions',
                      },
                      {
                        category: 'Interest' as const,
                        description: 'Product features, comparisons, "How does it work?"',
                      },
                      {
                        category: 'Consideration' as const,
                        description: 'Evaluating options, comparisons, reviews, decision-making',
                      },
                      {
                        category: 'Purchase' as const,
                        description: 'Pricing, "Where to buy?", purchase decisions',
                      },
                    ].map(({ category, description }) => (
                      <button
                        type="button"
                        key={category}
                        onClick={() => setSelectedCategory(category)}
                        aria-pressed={selectedCategory === category}
                        className={`w-full cursor-pointer rounded-lg border p-4 text-left transition-colors ${
                          selectedCategory === category
                            ? getCategoryAccentClasses(category)
                            : 'border-border hover:bg-muted/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center space-x-2">
                              <div className={`w-3 h-3 rounded ${getCategorySolidClass(category)}`}></div>
                              <span className="font-medium text-foreground">{category}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {description}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Modal Footer — fixed */}
              <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-border/50 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleCancelQuery}
                  className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveQuery}
                  disabled={!newQuery.trim() || !resolveTopic() || isSaving}
                  className="rounded-lg bg-primary px-6 py-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? 'Adding...' : 'Add Query'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
} 
