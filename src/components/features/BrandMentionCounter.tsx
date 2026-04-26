'use client'
import React from 'react';
import { analyzeBrandMentions, type BrandMentionAnalysis } from '@/lib/brand-mentions';

export { analyzeBrandMentions };

// Component to display brand mention analysis
interface BrandMentionCounterProps {
  analysis: BrandMentionAnalysis;
}

export function BrandMentionCounter({ analysis }: BrandMentionCounterProps) {
  const { brandName, brandDomain, competitors, results, totals } = analysis;
  
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
          <span className="text-sm font-semibold text-gray-700">Brand Mention & Citation Analysis</span>
        </div>
      </div>
      <div className="p-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
            <div className="text-2xl font-bold text-blue-700">{totals.totalBrandMentions}</div>
            <div className="text-sm text-blue-600 font-medium">Brand Mentions</div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
            <div className="text-2xl font-bold text-green-700">{totals.totalDomainCitations}</div>
            <div className="text-sm text-green-600 font-medium">Domain Citations</div>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200">
            <div className="text-2xl font-bold text-purple-700">{totals.totalCitations}</div>
            <div className="text-sm text-purple-600 font-medium">Total Citations</div>
          </div>
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-lg border border-orange-200">
            <div className="text-2xl font-bold text-orange-700">{totals.providersWithBrandMention}/{Object.keys(results).length}</div>
            <div className="text-sm text-orange-600 font-medium">Providers w/ Brand</div>
          </div>
          <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 rounded-lg border border-red-200">
            <div className="text-2xl font-bold text-red-700">{totals.totalCompetitorMentions}</div>
            <div className="text-sm text-red-600 font-medium">Competitor Mentions</div>
          </div>
          <div className="bg-gradient-to-br from-pink-50 to-pink-100 p-4 rounded-lg border border-pink-200">
            <div className="text-2xl font-bold text-pink-700">{totals.totalCompetitorCitations}</div>
            <div className="text-sm text-pink-600 font-medium">Competitor Citations</div>
          </div>
        </div>
        
        {/* Brand Information */}
        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Tracking Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Brand Name:</span>
              <span className="ml-2 font-medium text-gray-900">{brandName || 'Not specified'}</span>
            </div>
            <div>
              <span className="text-gray-600">Brand Domain:</span>
              <span className="ml-2 font-medium text-gray-900">{brandDomain || 'Not specified'}</span>
            </div>
          </div>
        </div>
        
        {/* Provider-specific Results */}
        <div className="space-y-4">
          {Object.entries(results).map(([providerKey, result]) => {
            if (!result) return null;
            
            const providerColors = {
              chatgpt: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', name: 'ChatGPT' },
              google: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', name: 'Google AI Overview' },
              perplexity: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', name: 'Perplexity AI' }
            };
            
            const colors = providerColors[result.provider];
            
            return (
              <div key={providerKey} className={`${colors.bg} ${colors.border} border rounded-lg p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className={`font-semibold ${colors.text}`}>{colors.name}</h4>
                  <div className="flex items-center space-x-4 text-sm">
                    <span className={`${result.brandMentioned ? 'text-green-600' : 'text-gray-500'}`}>
                      Brand: {result.brandMentioned ? '✓' : '✗'}
                    </span>
                    <span className={`${result.domainCited ? 'text-green-600' : 'text-gray-500'}`}>
                      Domain: {result.domainCited ? '✓' : '✗'}
                    </span>
                    <span className={`${result.competitorMentioned ? 'text-red-600' : 'text-gray-500'}`}>
                      Competitor: {result.competitorMentioned ? '✓' : '✗'}
                    </span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Brand Mentions:</span>
                    <span className={`ml-2 font-medium ${colors.text}`}>{result.brandMentionCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Domain Citations:</span>
                    <span className={`ml-2 font-medium ${colors.text}`}>{result.domainCitationCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Total Citations:</span>
                    <span className={`ml-2 font-medium ${colors.text}`}>{result.citationCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Competitor Mentions:</span>
                    <span className={`ml-2 font-medium text-red-700`}>{result.competitorMentionCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Competitor Citations:</span>
                    <span className={`ml-2 font-medium text-pink-700`}>{result.competitorCitationCount}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* No Results Message */}
        {Object.keys(results).length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-gray-900 mb-2">No Analysis Available</h3>
            <p className="text-xs text-gray-600">No query results available for brand mention analysis</p>
          </div>
        )}
      </div>
    </div>
  );
} 