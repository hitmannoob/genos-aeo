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
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';
import {
  Search,
  RefreshCw,
  AlertCircle,
  X
} from 'lucide-react';


export default function QueriesContent(): React.ReactElement {
  const { selectedBrand, brands, loading: brandLoading, refetchBrands } = useBrandContext();
  const { user } = useAuthContext();
  const { showSuccess, showError } = useToast();
  const [showResults, setShowResults] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState<any>(null);
  
  
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
    const fromKeywords: string[] = Array.isArray((selectedBrand as any).keywords)
      ? (selectedBrand as any).keywords
      : [];
    const fromQueries: string[] = Array.isArray((selectedBrand as any).queries)
      ? (selectedBrand as any).queries
          .map((q: any) => (typeof q?.keyword === 'string' ? q.keyword : ''))
          .filter((k: string) => k.length > 0 && k !== 'custom')
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

    const idToken = await getFirebaseIdTokenWithRetry(3, 500);
    if (!idToken) {
      throw new Error('Failed to get authentication token');
    }

    const response = await fetch(`/api/brands/${selectedBrand.id}/queries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
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
      await refetchBrands();
      setSelectedTopic(draft);
      setIsCreatingNewTopic(false);
      setNewTopicDraft('');
    } catch (e) {
      console.error('❌ Error adding topic:', e);
      showError('Failed to add topic', 'Please try again.');
    }
  };

  const handleSaveQuery = async () => {
    const topic = resolveTopic();
    if (!newQuery.trim() || !selectedBrand || !user) {
      console.error('Missing required data for saving query');
      return;
    }
    if (!topic) {
      showError('Topic required', 'Pick an existing topic or create a new one.');
      return;
    }

    setIsSaving(true);

    try {
      // Register the topic on the brand first if it's new. arrayUnion silently
      // no-ops if it already exists, so it's safe to call even when the user
      // picked an existing topic.
      const isNewTopic =
        isCreatingNewTopic &&
        !existingTopics.some(t => t.toLowerCase() === topic.toLowerCase());
      if (isNewTopic) {
        await postBrandMutation({
          action: 'addKeyword',
          keyword: topic,
        });
      }

      await postBrandMutation({
        action: 'addQuery',
        query: newQuery,
        category: selectedCategory,
        keyword: topic,
      });

      resetModal();
      setShowAddQueryModal(false);

      await refetchBrands();

      showSuccess(
        'Query added',
        isNewTopic
          ? `New topic "${topic}" created and query attached.`
          : 'Your new query is ready to process.'
      );
    } catch (error) {
      console.error('❌ Error saving query:', error);
      showError('Failed to add query', 'Please try again in a moment.');
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
          <Link href="/dashboard/add-brand/step-1" className="bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 transition-colors">
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
            <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">
              {/* Modal Header — fixed */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border/50 flex-shrink-0">
                <h3 className="text-lg font-semibold text-foreground">Add New Query</h3>
                <button
                  onClick={handleCancelQuery}
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
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Query
                  </label>
                  <input
                    type="text"
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    onKeyDown={handleQueryKeyDown}
                    placeholder="e.g. what is the best tool for GEO? FYI it's Genos 😊"
                    className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000C60] focus:border-transparent bg-background text-foreground"
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
                            onClick={() => setSelectedTopic(topic)}
                            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
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
                          value={newTopicDraft}
                          onChange={(e) => setNewTopicDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newTopicDraft.trim()) {
                              e.preventDefault();
                              void handleConfirmNewTopic();
                            }
                          }}
                          placeholder="e.g. LLM Observability"
                          className="flex-1 px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000C60] focus:border-transparent bg-background text-foreground"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => void handleConfirmNewTopic()}
                          disabled={!newTopicDraft.trim()}
                          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                    {/* Awareness */}
                    <div 
                      onClick={() => setSelectedCategory('Awareness')}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selectedCategory === 'Awareness' 
                          ? 'border-blue-300 bg-blue-50' 
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 rounded bg-blue-500"></div>
                            <span className="font-medium text-foreground">Awareness</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Brand discovery, "What is [brand]?", company mentions
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Interest */}
                    <div 
                      onClick={() => setSelectedCategory('Interest')}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selectedCategory === 'Interest' 
                          ? 'border-purple-300 bg-purple-50' 
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 rounded bg-purple-500"></div>
                            <span className="font-medium text-foreground">Interest</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Product features, comparisons, "How does it work?"
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Consideration */}
                    <div 
                      onClick={() => setSelectedCategory('Consideration')}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selectedCategory === 'Consideration' 
                          ? 'border-pink-300 bg-pink-50' 
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 rounded bg-pink-500"></div>
                            <span className="font-medium text-foreground">Consideration</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Evaluating options, comparisons, reviews, decision-making
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Purchase */}
                    <div 
                      onClick={() => setSelectedCategory('Purchase')}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selectedCategory === 'Purchase' 
                          ? 'border-orange-300 bg-orange-50' 
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 rounded bg-orange-500"></div>
                            <span className="font-medium text-foreground">Purchase</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Pricing, "Where to buy?", purchase decisions
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer — fixed */}
              <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-border/50 flex-shrink-0">
                <button
                  onClick={handleCancelQuery}
                  className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveQuery}
                  disabled={!newQuery.trim() || !resolveTopic() || isSaving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
