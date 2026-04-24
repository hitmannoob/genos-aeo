'use client'
import React, { useState } from 'react';
import Link from 'next/link';
import { useBrandContext } from '@/context/BrandContext';
import DashboardLayout from '@/components/layout/DashboardLayout';
import QueriesOverview from '@/components/features/QueriesOverview';
import { useAuthContext } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { addQueryToBrand } from '@/firebase/firestore/addQuery';
import AIResponseModal from './AIResponseModal';
import WebLogo from '@/components/shared/WebLogo';
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
  const [isSaving, setIsSaving] = useState(false);

  // Add Query Modal Handlers
  const handleAddQuery = () => {
    setShowAddQueryModal(true);
  };

  const handleSaveQuery = async () => {
    if (!newQuery.trim() || !selectedBrand || !user) {
      console.error('Missing required data for saving query');
      return;
    }

    setIsSaving(true);

    try {
      await addQueryToBrand(selectedBrand.id, newQuery, selectedCategory, {
        companyName: selectedBrand.companyName,
        domain: selectedBrand.domain,
      });

      // Reset form and close modal
      setNewQuery('');
      setSelectedCategory('Awareness');
      setShowAddQueryModal(false);

      await refetchBrands();

      showSuccess('Query added', 'Your new query is ready to process.');
    } catch (error) {
      console.error('❌ Error saving query:', error);
      showError('Failed to add query', 'Please try again in a moment.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelQuery = () => {
    setNewQuery('');
    setSelectedCategory('Awareness');
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
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">Add New Query</h3>
                <button
                  onClick={handleCancelQuery}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="space-y-6">
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

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 mt-6">
                <button
                  onClick={handleCancelQuery}
                  className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveQuery}
                  disabled={!newQuery.trim() || isSaving}
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