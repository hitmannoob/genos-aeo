'use client'
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, ArrowRight, Building2, Tag, RefreshCw, Globe, Sparkles, Target, Edit3, Plus, X } from 'lucide-react';
import WebLogo from '@/components/shared/WebLogo';
import { CompanyInfoSchema, type CompanyInfo } from '@/lib/get-company-info';
import { normalizePublicDomain } from '@/lib/domainValidation';

const MAX_EDITABLE_ITEMS = 20;

function normalizeEditableList(items: string[], limit = MAX_EDITABLE_ITEMS): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of items) {
    const value = item.trim();
    const key = value.toLowerCase();
    if (!value || value.length > 160 || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
    if (normalized.length === limit) break;
  }
  return normalized;
}

export default function AddBrandStep2(): React.ReactElement {
  const router = useRouter();
  const [domain, setDomain] = useState<string>('');
  const [companyData, setCompanyData] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Editing states
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingProducts, setEditingProducts] = useState(false);
  const [editingKeywords, setEditingKeywords] = useState(false);
  const [editingCompetitors, setEditingCompetitors] = useState(false);
  
  // Temporary edit values
  const [tempDescription, setTempDescription] = useState('');
  const [tempProducts, setTempProducts] = useState<string[]>([]);
  const [tempKeywords, setTempKeywords] = useState<string[]>([]);
  const [tempCompetitors, setTempCompetitors] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [newCompetitor, setNewCompetitor] = useState('');
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [validationError, setValidationError] = useState('');
  
  useEffect(() => {
    // Get domain and company info data from sessionStorage
    const storedDomain = sessionStorage.getItem('brandDomain');
    const storedCompanyInfo = sessionStorage.getItem('companyInfo');
    
    if (!storedDomain || !storedCompanyInfo) {
      // If no domain found, redirect back to step 1
      router.push('/dashboard/add-brand/step-1');
      return;
    }
    
    try {
      const normalizedDomain = normalizePublicDomain(storedDomain);
      const parsedCompanyInfo = CompanyInfoSchema.safeParse(JSON.parse(storedCompanyInfo));
      if (!parsedCompanyInfo.success) throw new Error('Invalid company information');
      setDomain(normalizedDomain);
      setCompanyData(parsedCompanyInfo.data);
    } catch {
      sessionStorage.removeItem('brandDomain');
      sessionStorage.removeItem('companyInfo');
      router.replace('/dashboard/add-brand/step-1');
      return;
    }
    
    setLoading(false);
  }, [router]);

  const handleReanalyze = () => {
    // Clear company data and go back to step 1 for re-analysis
    sessionStorage.removeItem('companyInfo');
    router.push('/dashboard/add-brand/step-1');
  };

  const handleContinue = () => {
    if (!companyData || companyData.keywords.length === 0) {
      setValidationError('Add at least one keyword before continuing so queries can be generated.');
      return;
    }
    setValidationError('');
    router.push('/dashboard/add-brand/step-3');
  };

  const persistCompanyData = (candidate: CompanyInfo): boolean => {
    const parsed = CompanyInfoSchema.safeParse(candidate);
    if (!parsed.success) {
      setValidationError('The edited company information is invalid. Check item lengths and remove blank values.');
      return false;
    }
    setValidationError('');
    setCompanyData(parsed.data);
    sessionStorage.setItem('companyInfo', JSON.stringify(parsed.data));
    return true;
  };

  // Editing functions
  const startEditingDescription = () => {
    setTempDescription(companyData?.shortDescription || '');
    setEditingDescription(true);
  };

  const saveDescription = () => {
    if (companyData) {
      if (!persistCompanyData({ ...companyData, shortDescription: tempDescription.trim() })) return;
    }
    setEditingDescription(false);
  };

  const cancelEditingDescription = () => {
    setEditingDescription(false);
    setTempDescription('');
  };

  const startEditingProducts = () => {
    setTempProducts([...(companyData?.productsAndServices || [])]);
    setEditingProducts(true);
  };

  const saveProducts = () => {
    if (companyData) {
      if (!persistCompanyData({
        ...companyData,
        productsAndServices: normalizeEditableList(tempProducts),
      })) return;
    }
    setEditingProducts(false);
  };

  const cancelEditingProducts = () => {
    setEditingProducts(false);
    setTempProducts([]);
  };

  const addProduct = () => {
    if (tempProducts.length < MAX_EDITABLE_ITEMS) setTempProducts([...tempProducts, '']);
  };

  const updateProduct = (index: number, value: string) => {
    const updated = [...tempProducts];
    updated[index] = value;
    setTempProducts(updated);
  };

  const removeProduct = (index: number) => {
    setTempProducts(tempProducts.filter((_, i) => i !== index));
  };

  const startEditingKeywords = () => {
    setTempKeywords([...(companyData?.keywords || [])]);
    setEditingKeywords(true);
  };

  const saveKeywords = () => {
    // Commit any pending input the user typed but didn't click + on yet —
    // otherwise hitting Save discards their typed value.
    const draft = newKeyword.trim();
    const finalKeywords = normalizeEditableList(
      draft && !tempKeywords.some((item) => item.toLowerCase() === draft.toLowerCase()) && tempKeywords.length < 10
        ? [...tempKeywords, draft]
        : tempKeywords,
      10
    );
    if (companyData) {
      if (!persistCompanyData({ ...companyData, keywords: finalKeywords })) return;
    }
    setNewKeyword('');
    setEditingKeywords(false);
  };

  const cancelEditingKeywords = () => {
    setEditingKeywords(false);
    setTempKeywords([]);
    setNewKeyword('');
  };

  const addKeyword = () => {
    if (newKeyword.trim() && !tempKeywords.some((item) => item.toLowerCase() === newKeyword.trim().toLowerCase()) && tempKeywords.length < 10) {
      setTempKeywords([...tempKeywords, newKeyword.trim()]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (index: number) => {
    setTempKeywords(tempKeywords.filter((_, i) => i !== index));
  };

  const startEditingCompetitors = () => {
    setTempCompetitors([...(companyData?.competitors || [])]);
    setEditingCompetitors(true);
  };

  const saveCompetitors = () => {
    const draft = newCompetitor.trim();
    const finalCompetitors = normalizeEditableList(
      draft && !tempCompetitors.some((item) => item.toLowerCase() === draft.toLowerCase()) && tempCompetitors.length < 10
        ? [...tempCompetitors, draft]
        : tempCompetitors,
      10
    );
    if (companyData) {
      if (!persistCompanyData({ ...companyData, competitors: finalCompetitors })) return;
    }
    setNewCompetitor('');
    setEditingCompetitors(false);
  };

  const cancelEditingCompetitors = () => {
    setEditingCompetitors(false);
    setTempCompetitors([]);
    setNewCompetitor('');
  };

  const addCompetitor = () => {
    if (newCompetitor.trim() && !tempCompetitors.some((item) => item.toLowerCase() === newCompetitor.trim().toLowerCase()) && tempCompetitors.length < 10) {
      setTempCompetitors([...tempCompetitors, newCompetitor.trim()]);
      setNewCompetitor('');
    }
  };

  const removeCompetitor = (index: number) => {
    setTempCompetitors(tempCompetitors.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header with Logo */}
      <div className="flex justify-center pt-8 pb-6">
        <div className="flex flex-col items-center space-y-2">
          {/* Genos Logo */}
          <div className="relative w-48 h-[53px]">
            <Image
              src="/genos-wordmark.png"
              alt="Genos Logo"
              width={512}
              height={141}
              className="h-auto w-48"
              priority
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex justify-center px-4">
        <div className="w-full max-w-6xl">
          {/* Step Indicators */}
          <div className="flex justify-center mb-12">
            <div className="flex items-center space-x-8">
              {/* Step 1 - Completed */}
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-lg font-semibold mb-2">
                  ✓
                </div>
                <span className="text-muted-foreground text-sm">Domain</span>
              </div>

              {/* Connector */}
              <div className="w-16 h-px bg-primary"></div>

              {/* Step 2 - Active */}
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-lg font-semibold mb-2">
                  2
                </div>
                <span className="text-foreground text-sm font-medium">Brand</span>
              </div>

              {/* Connector */}
              <div className="w-16 h-px bg-border"></div>

              {/* Step 3 - Inactive */}
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-muted text-muted-foreground rounded-full flex items-center justify-center text-lg font-semibold mb-2">
                  3
                </div>
                <span className="text-muted-foreground text-sm">Queries</span>
              </div>
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
            {companyData ? (
              <div className="space-y-8">
                {/* Brand Header with Logo */}
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold text-foreground">Brand Analysis</h1>
                    <button
                      onClick={handleReanalyze}
                      className="text-primary hover:text-primary/80 flex items-center space-x-1 text-sm"
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span>Re-analyze</span>
                    </button>
                  </div>
                  
                  <div className="flex items-start space-x-6">
                    {/* Web Logo */}
                    <div className="flex-shrink-0">
                      <WebLogo domain={domain} size={64} className="shadow-lg" />
                    </div>
                    
                    {/* Company Info */}
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-3">
                        <h2 className="text-2xl font-bold text-foreground">{companyData.companyName || 'Unknown Company'}</h2>
                        <span className="text-muted-foreground">({domain})</span>
                      </div>
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-semibold text-foreground">Short Description</h3>
                          <button
                            onClick={startEditingDescription}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                        {editingDescription ? (
                          <div className="space-y-3">
                            <textarea
                              value={tempDescription}
                              onChange={(e) => setTempDescription(e.target.value)}
                              className="w-full p-3 border border-border rounded-lg bg-background text-foreground resize-none"
                              rows={3}
                              maxLength={2000}
                              placeholder="Enter company description..."
                            />
                            <div className="flex space-x-2">
                              <button
                                onClick={saveDescription}
                                className="px-3 py-1 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditingDescription}
                                className="px-3 py-1 bg-muted text-muted-foreground text-sm rounded-lg hover:bg-border transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-lg">
                            {companyData.shortDescription || 'No description available'}
                          </p>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap gap-4">
                        <div className="flex items-center space-x-2">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                          <a
                            href={companyData.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline"
                          >
                            {companyData.website}
                          </a>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Sparkles className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">AI-Powered Analysis</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Company Information Content */}
                  <div className="space-y-6">
                    {/* Key Information Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Products & Services */}
                      <div className="bg-background border border-border rounded-xl p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-primary rounded-lg">
                              <Building2 className="h-5 w-5 text-primary-foreground" />
                            </div>
                            <h4 className="text-foreground font-semibold">Products & Services</h4>
                          </div>
                          <button
                            onClick={startEditingProducts}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                        
                        {editingProducts ? (
                          <div className="space-y-3">
                            {tempProducts.map((product, index) => (
                              <div key={index} className="flex items-center space-x-2">
                                <input
                                  type="text"
                                  value={product}
                                  onChange={(e) => updateProduct(index, e.target.value)}
                                  maxLength={160}
                                  className="flex-1 p-2 border border-border rounded-lg bg-background text-foreground text-sm"
                                  placeholder="Enter product or service..."
                                />
                                <button
                                  onClick={() => removeProduct(index)}
                                  className="p-1 text-red-500 hover:text-red-700 transition-colors"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={addProduct}
                              disabled={tempProducts.length >= MAX_EDITABLE_ITEMS}
                              className="flex items-center space-x-1 text-primary hover:text-primary/80 transition-colors text-sm"
                            >
                              <Plus className="h-4 w-4" />
                              <span>Add product/service</span>
                            </button>
                            <div className="flex space-x-2 pt-2">
                              <button
                                onClick={saveProducts}
                                className="px-3 py-1 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditingProducts}
                                className="px-3 py-1 bg-muted text-muted-foreground text-sm rounded-lg hover:bg-border transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(companyData.productsAndServices && companyData.productsAndServices.length > 0) ? (
                              <>
                                {(showAllProducts
                                  ? companyData.productsAndServices
                                  : companyData.productsAndServices.slice(0, 6)
                                ).map((item: string, index: number) => (
                                  <div key={index} className="text-sm text-muted-foreground break-words">
                                    • {item}
                                  </div>
                                ))}
                                {companyData.productsAndServices.length > 6 && (
                                  <button
                                    type="button"
                                    onClick={() => setShowAllProducts((v) => !v)}
                                    className="text-sm text-primary font-medium hover:text-primary/80 transition-colors"
                                  >
                                    {showAllProducts
                                      ? 'Show less'
                                      : `+ ${companyData.productsAndServices.length - 6} more offerings`}
                                  </button>
                                )}
                              </>
                            ) : (
                              <div className="text-sm text-muted-foreground">
                                No products or services listed
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Keywords */}
                      <div className="bg-background border border-border rounded-xl p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-primary rounded-lg">
                              <Tag className="h-5 w-5 text-primary-foreground" />
                            </div>
                            <h4 className="text-foreground font-semibold">Topics & Semantic Clusters</h4>
                          </div>
                          <button
                            onClick={startEditingKeywords}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                        
                        {editingKeywords ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2 mb-3">
                              {tempKeywords.map((keyword, index) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center gap-1 px-3 py-1 bg-card border border-border text-foreground text-sm rounded-md max-w-full break-all"
                                >
                                  {keyword}
                                  <button
                                    onClick={() => removeKeyword(index)}
                                    className="text-red-500 hover:text-red-700 transition-colors"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={newKeyword}
                                onChange={(e) => setNewKeyword(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addKeyword();
                                  }
                                }}
                                disabled={tempKeywords.length >= 10}
                                maxLength={160}
                                className="flex-1 p-2 border border-border rounded-lg bg-background text-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder={tempKeywords.length >= 10 ? "Maximum 10 keywords reached" : "Add keyword..."}
                              />
                              <button
                                type="button"
                                onClick={addKeyword}
                                disabled={tempKeywords.length >= 10 || !newKeyword.trim()}
                                className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {tempKeywords.length}/10 keywords added
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={saveKeywords}
                                className="px-3 py-1 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditingKeywords}
                                className="px-3 py-1 bg-muted text-muted-foreground text-sm rounded-lg hover:bg-border transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {(companyData.keywords && companyData.keywords.length > 0) ? (
                              companyData.keywords.map((keyword: string, index: number) => (
                                <span
                                  key={index}
                                  className="inline-block max-w-full px-3 py-1 bg-card border border-border text-foreground text-sm rounded-md break-all"
                                >
                                  {keyword}
                                </span>
                              ))
                            ) : (
                              <div className="text-sm text-muted-foreground">
                                No keywords listed
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Competitors */}
                      <div className="bg-background border border-border rounded-xl p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-primary rounded-lg">
                              <Target className="h-5 w-5 text-primary-foreground" />
                            </div>
                            <h4 className="text-foreground font-semibold">Competitors</h4>
                          </div>
                          <button
                            onClick={startEditingCompetitors}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                        
                        {editingCompetitors ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2 mb-3">
                              {tempCompetitors.map((competitor, index) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center gap-1 px-3 py-1 bg-card border border-border text-foreground text-sm rounded-md max-w-full break-all"
                                >
                                  {competitor}
                                  <button
                                    onClick={() => removeCompetitor(index)}
                                    className="text-red-500 hover:text-red-700 transition-colors"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={newCompetitor}
                                onChange={(e) => setNewCompetitor(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addCompetitor();
                                  }
                                }}
                                disabled={tempCompetitors.length >= 10}
                                maxLength={160}
                                className="flex-1 p-2 border border-border rounded-lg bg-background text-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder={tempCompetitors.length >= 10 ? "Maximum 10 competitors reached" : "Add competitor..."}
                              />
                              <button
                                type="button"
                                onClick={addCompetitor}
                                disabled={tempCompetitors.length >= 10 || !newCompetitor.trim()}
                                className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {tempCompetitors.length}/10 competitors added
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={saveCompetitors}
                                className="px-3 py-1 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditingCompetitors}
                                className="px-3 py-1 bg-muted text-muted-foreground text-sm rounded-lg hover:bg-border transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {(companyData.competitors && companyData.competitors.length > 0) ? (
                              companyData.competitors.map((competitor: string, index: number) => (
                                <span
                                  key={index}
                                  className="inline-block max-w-full px-3 py-1 bg-card border border-border text-foreground text-sm rounded-md break-all"
                                >
                                  {competitor}
                                </span>
                              ))
                            ) : (
                              <div className="text-sm text-muted-foreground">
                                No competitors listed
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                    </div>


                  </div>

                {validationError && (
                  <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                    {validationError}
                  </div>
                )}

                {/* Navigation Buttons */}
                <div className="flex justify-between pt-6">
                  <button
                    onClick={() => router.push('/dashboard/add-brand/step-1')}
                    className="flex items-center space-x-2 bg-muted text-foreground px-6 py-3 rounded-xl hover:bg-border transition-colors"
                  >
                    <ArrowLeft className="h-5 w-5" />
                    <span>Back to Domain</span>
                  </button>

                  <button
                    onClick={handleContinue}
                    className="flex items-center space-x-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    <span>Continue to Queries</span>
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              /* Fallback if no company data */
              <div className="text-center">
                <div className="mb-6">
                  <Globe className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h1 className="text-3xl font-bold text-foreground mb-4">
                    No Company Information Found
                  </h1>
                  <p className="text-muted-foreground text-lg mb-8">
                    Please go back to Step 1 to get company information first.
                  </p>
                </div>

                <button
                  onClick={() => router.push('/dashboard/add-brand/step-1')}
                  className="flex items-center space-x-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl hover:bg-primary/90 transition-colors mx-auto"
                >
                  <ArrowLeft className="h-5 w-5" />
                  <span>Back to Step 1</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 
