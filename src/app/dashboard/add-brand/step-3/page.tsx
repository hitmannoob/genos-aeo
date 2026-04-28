'use client'
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, Check, Search, Sparkles, RefreshCw, Eye, Tag, TrendingUp, ShoppingCart, Lightbulb, Target, X, Plus, AlertCircle } from 'lucide-react';
import WebLogo from '@/components/shared/WebLogo';
import { CompanyInfo } from '@/lib/get-company-info';
import { useAIQuery } from '@/hooks/useAIQuery';
import { useUserCredits } from '@/hooks/useUserCredits';
import { useAuthContext } from '@/context/AuthContext';
import { generateRealisticAnalytics } from '@/utils/generateBrandData';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';
import {
  QUERY_CATEGORIES,
  getCategoryPillClasses,
  getCategorySolidClass,
} from '@/lib/queryCategories';

interface GeneratedQuery {
  keyword: string;
  query: string;
  category: 'Awareness' | 'Interest' | 'Consideration' | 'Purchase';
  containsBrand: 0 | 1;
}

export default function AddBrandStep3(): React.ReactElement {
  const router = useRouter();
  const { user, refreshUserProfile } = useAuthContext();
  const { refetchBrands, setSelectedBrandId, clearBrandContext } = useBrandContext();
  const { credits, loading: creditsLoading } = useUserCredits();
  const { showSuccess, showError, showInfo } = useToast();
  const [domain, setDomain] = useState<string>('');
  const [companyData, setCompanyData] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatedQueries, setGeneratedQueries] = useState<GeneratedQuery[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [intentFilter, setIntentFilter] = useState<'all' | 'Awareness' | 'Interest' | 'Consideration' | 'Purchase'>('all');
  const [openFilter, setOpenFilter] = useState<'intent' | 'topic' | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const [showAddTopicModal, setShowAddTopicModal] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [additionalTopics, setAdditionalTopics] = useState<string[]>([]);
  const [showAddQueryModal, setShowAddQueryModal] = useState(false);
  const [newQuery, setNewQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'Awareness' | 'Interest' | 'Consideration' | 'Purchase'>('Awareness');
  // Query-modal topic picker state. Separate from the sidebar's selectedTopic
  // (which is a filter, not an "I'm attaching to this topic" signal).
  const [newQueryTopic, setNewQueryTopic] = useState<string>('');
  const [isCreatingNewQueryTopic, setIsCreatingNewQueryTopic] = useState<boolean>(false);
  const [newQueryTopicDraft, setNewQueryTopicDraft] = useState<string>('');
  const [isCompleting, setIsCompleting] = useState(false);
  const [selectedQueries, setSelectedQueries] = useState<Set<number>>(new Set());
  // Set when the atomic brand-create transaction reports BRAND_ALREADY_EXISTS;
  // drives the "open existing" modal. Stores the existing brand id so the
  // modal's confirm action can navigate straight to it.
  const [existingBrandId, setExistingBrandId] = useState<string | null>(null);

  // Guards against auto-generating queries more than once per company. React
  // StrictMode (and any setState that retriggers the effect before the first
  // generation completes) would otherwise fire two `/api/ai-query` calls.
  const autoGenerationStartedRef = useRef(false);

  const { queryState, executeQuery, clearQuery } = useAIQuery();

  useEffect(() => {
    // Get domain and company info from sessionStorage
    const storedDomain = sessionStorage.getItem('brandDomain');
    const storedCompanyInfo = sessionStorage.getItem('companyInfo');
    
    if (!storedDomain || !storedCompanyInfo) {
      // Redirect to step 1 if missing data
      router.push('/dashboard/add-brand/step-1');
      return;
    }
    
    setDomain(storedDomain);
    
    try {
      const parsedCompanyInfo = JSON.parse(storedCompanyInfo);
      setCompanyData(parsedCompanyInfo);
    } catch (error) {
      console.error('Failed to parse company info:', error);
      router.push('/dashboard/add-brand/step-1');
      return;
    }
    
    setLoading(false);
  }, [router]);

  // Auto-generate queries when company data is loaded
  useEffect(() => {
    if (
      !companyData ||
      !companyData.keywords ||
      companyData.keywords.length === 0 ||
      generatedQueries.length > 0 ||
      autoGenerationStartedRef.current
    ) {
      return;
    }

    autoGenerationStartedRef.current = true;
    const handle = setTimeout(() => {
      generateQueries();
    }, 500);

    return () => clearTimeout(handle);
  }, [companyData, generatedQueries.length]);

  const generateQueries = async () => {
    if (!companyData) return;
    
    setIsGenerating(true);
    
    const prompt = `You are an AI assistant that generates realistic and user-centric search queries based on brand information.

Given:
- Brand: ${companyData.companyName}
- Description: ${companyData.shortDescription}
- Products & Services: ${companyData.productsAndServices?.join(', ')}
- Keywords: ${companyData.keywords?.join(', ')}

Task:
1. For each keyword, generate 2–3 realistic, natural-sounding user search queries that span various funnel stages: **Awareness**, **Interest**, **Consideration**, and **Purchase**.
2. Assign the appropriate funnel stage to each query using the \`category\` field.
3. If the brand is well-known (e.g., Coca-Cola, Nike) or moderately known (e.g., Shoeshack, HubSpot), include the brand name in **only 1–2 queries total**. All other queries should remain brand-agnostic while still being contextually relevant.
4. Use the \`containsBrand\` field to indicate whether the query explicitly includes the brand name:
   - \`1\` = brand name is present
   - \`0\` = brand name is not present
5. Ensure all queries are natural, human-like, relevant to the brand's actual category, and free from inappropriate or misleading content.

Output format (return ONLY valid JSON array):
[
  {
    "keyword": "crm tools",
    "query": "best crm tools for startups",
    "category": "Interest",
    "containsBrand": 0
  },
  {
    "keyword": "crm tools", 
    "query": "is HubSpot good for small business CRM?",
    "category": "Consideration",
    "containsBrand": 1
  }
]`;

    try {
      await executeQuery(
        prompt,
        ['chatgptsearch', 'google-gemini'],
        'high'
      );
    } catch (error) {
      console.error('Failed to generate queries:', error);
      setIsGenerating(false);
    }
  };

  // Close the prompt-table filter dropdown when clicking outside.
  useEffect(() => {
    if (!openFilter) return;
    const handler = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openFilter]);

  // Watch for query results
  useEffect(() => {
    console.log('🔍 Query State Changed:', queryState);
    
    if (queryState.result && !queryState.loading) {
      try {
        console.log('📊 Raw AI Response:', queryState.result);
        const aiResponse = queryState.result.data;
        console.log('📋 AI Response Data:', aiResponse);
        
        let parsedQueries: GeneratedQuery[] = [];
        
        if (typeof aiResponse === 'string') {
          console.log('🔤 Parsing string response...');
          // Try to extract JSON from the string if it's wrapped in text
          const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            parsedQueries = JSON.parse(jsonMatch[0]);
          } else {
            parsedQueries = JSON.parse(aiResponse);
          }
        } else if (Array.isArray(aiResponse)) {
          console.log('📋 Using array response...');
          parsedQueries = aiResponse;
        } else if (aiResponse && typeof aiResponse === 'object') {
          console.log('🔄 Object response, checking structure...');
          
          // Check if response has a content field (OpenAI format)
          if (aiResponse.content && typeof aiResponse.content === 'string') {
            console.log('📄 Found content field, parsing...');
            const jsonMatch = aiResponse.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsedQueries = JSON.parse(jsonMatch[0]);
            } else {
              parsedQueries = JSON.parse(aiResponse.content);
            }
          }
          // Check if response has responses array (API provider format)
          else if (aiResponse.responses && Array.isArray(aiResponse.responses)) {
            console.log('📄 Found responses array, extracting content...');
            const firstResponse = aiResponse.responses[0];
            if (firstResponse && firstResponse.content) {
              console.log('📄 Raw content:', firstResponse.content);
              // Clean the content by removing extra whitespace and line breaks
              let cleanContent = firstResponse.content.trim();
              
              // Try to extract JSON array from the content
              const jsonMatch = cleanContent.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                console.log('📄 Extracted JSON:', jsonMatch[0]);
                parsedQueries = JSON.parse(jsonMatch[0]);
              } else {
                // If no match, try parsing the entire content
                console.log('📄 Parsing entire content...');
                parsedQueries = JSON.parse(cleanContent);
              }
            }
          }
          // Check if it's a direct object with provider and content
          else if (aiResponse.provider && aiResponse.content) {
            console.log('📄 Found provider response format...');
            const jsonMatch = aiResponse.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsedQueries = JSON.parse(jsonMatch[0]);
            } else {
              parsedQueries = JSON.parse(aiResponse.content);
            }
          }
          else {
            console.log('🔄 Unexpected object format:', aiResponse);
          }
        } else {
          console.log('🔄 Unexpected response format:', typeof aiResponse);
        }
        
        console.log('✅ Found queries:', parsedQueries);
        setGeneratedQueries(parsedQueries);
        
        // Auto-select all newly generated queries
        setSelectedQueries(new Set(parsedQueries.map((_, index) => index)));
        
        // Show success notification for auto-generated queries
        if (parsedQueries.length > 0) {
          showSuccess(
            'Query Search Completed!',
            `Found ${parsedQueries.length} relevant queries for ${companyData?.companyName}. You can add more or edit existing ones.`
          );
        }
              } catch (error) {
          console.error('❌ Failed to parse found queries:', error);
        console.error('Raw response:', queryState.result.data);
        console.error('Error details:', error);
        
        // Try alternative parsing for debugging
        if (queryState.result.data?.responses?.[0]?.content) {
          const content = queryState.result.data.responses[0].content;
          console.log('🔧 Full content for debugging:', content);
          
          // Try to manually extract and parse
          try {
            const startIndex = content.indexOf('[');
            const endIndex = content.lastIndexOf(']');
            if (startIndex !== -1 && endIndex !== -1) {
              const jsonStr = content.substring(startIndex, endIndex + 1);
              console.log('🔧 Extracted JSON string:', jsonStr);
              const manualParsed = JSON.parse(jsonStr);
              console.log('🔧 Manual parsing successful:', manualParsed);
              setGeneratedQueries(manualParsed);
            }
          } catch (manualError) {
            console.error('🔧 Manual parsing also failed:', manualError);
          }
        }
      }
      setIsGenerating(false);
    }
    
    if (queryState.error) {
      console.error('❌ Query error:', queryState.error);
      setIsGenerating(false);
    }
  }, [queryState]);

  const handleComplete = async () => {
    if (!companyData || selectedQueries.size < 4 || !user?.uid) {
      console.error('Missing required data for completion:', {
        hasCompanyData: !!companyData,
        hasMinimumQueries: selectedQueries.size >= 4,
        selectedCount: selectedQueries.size,
        minimumRequired: 4,
        hasUser: !!user?.uid
      });
      return;
    }

    // Wait for the credit balance to load before deciding — without this guard
    // a freshly signed-up user can hit Complete while the profile is still
    // being created and see a spurious "Insufficient Credits" error.
    if (creditsLoading) {
      showInfo('Loading account', 'Just a moment while we load your credit balance.');
      return;
    }

    // Check if user has enough credits
    if (credits < 100) {
      showError(
        'Insufficient Credits',
        `You need 100 credits to complete brand setup, but you only have ${credits} credits available. Please purchase more credits to continue.`
      );
      return;
    }

    setIsCompleting(true);

    try {
      console.log('🚀 Generating brand analytics...');

      // Generate brand analytics data client-side
      const brandsbasicData = generateRealisticAnalytics(
        companyData.companyName,
        domain,
        companyData.keywords || []
      );

      console.log('✅ Brand analytics generated:', brandsbasicData);

      // Prepare the complete brand payload sent to /api/brands.
      const completeBrandData = {
        // User Information
        userId: user.uid,

        // Step 1 - Domain Information
        domain: domain,
        website: companyData.website,

        // Step 2 - Company Information
        companyName: companyData.companyName,
        shortDescription: companyData.shortDescription,
        productsAndServices: companyData.productsAndServices || [],
        // Persist every topic that's actually in use — declared topics plus
        // any query-derived ones — so the brand's keyword list matches what
        // its queries reference. Dedupe case-insensitively.
        keywords: allTopics,
        competitors: companyData.competitors || [],

        // Step 3 - Generated Queries (only selected ones)
        queries: generatedQueries
          .filter((_, index) => selectedQueries.has(index))
          .map(query => ({
            keyword: query.keyword,
            query: query.query,
            category: query.category,
            containsBrand: query.containsBrand,
            selected: true
          })),

        // Query distribution by category (only selected queries)
        queryDistribution: {
          awareness: generatedQueries.filter((q, i) => selectedQueries.has(i) && q.category === 'Awareness').length,
          interest: generatedQueries.filter((q, i) => selectedQueries.has(i) && q.category === 'Interest').length,
          consideration: generatedQueries.filter((q, i) => selectedQueries.has(i) && q.category === 'Consideration').length,
          purchase: generatedQueries.filter((q, i) => selectedQueries.has(i) && q.category === 'Purchase').length
        },

        // AI Analysis metadata (if available)
        aiAnalysis: queryState.result ? {
          providersUsed: queryState.result.debug?.providersExecuted || [],
          totalCost: queryState.result.totalCost || 0,
          completedAt: queryState.result.completedAt || new Date().toISOString(),
          requestId: queryState.result.requestId || null
        } : null,

        // Generated brand analytics
        brandsbasicData,

        // Metadata — server-authoritative audit timestamps.
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // `timestamp` (ms-since-epoch) is kept for legacy sort fallbacks in
        // useUserBrands; new readers should prefer createdAt.
        timestamp: Date.now(),
        totalQueries: selectedQueries.size,
        setupComplete: true,
        currentStep: 3,

        // Credit usage tracking. creditTransaction.timestamp lives inside a
        // nested map (not an array), so new Date().toISOString() is allowed and
        // matches the audit-timestamp policy for the rest of this doc.
        creditsUsed: 100,
        creditTransaction: {
          amount: 100,
          type: 'deduction',
          reason: 'Brand setup completion',
          timestamp: new Date().toISOString()
        }
      };

      // Generate user-scoped document ID to prevent conflicts
      const cleanDomain = domain.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const brandId = `${user.uid}_${cleanDomain}`;

      console.log('💾 Saving brand and deducting credits on the server...');
      const idToken = await getFirebaseIdTokenWithRetry(3, 500);
      if (!idToken) {
        showError(
          'Authentication Failed',
          'Please sign in again and retry brand creation.'
        );
        setIsCompleting(false);
        return;
      }

      const response = await fetch('/api/brands', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          brandId,
          brandData: completeBrandData,
        }),
      });

      const txResult = await response.json();

      if (!response.ok || !txResult.success) {
        if (txResult.code === 'INSUFFICIENT_CREDITS') {
          showError(
            'Insufficient Credits',
            'You need 100 credits to complete brand setup. Please purchase more credits to continue.'
          );
          setIsCompleting(false);
          return;
        }

        if (txResult.code === 'BRAND_ALREADY_EXISTS') {
          setExistingBrandId(brandId);
          setIsCompleting(false);
          return;
        }

        if (txResult.code === 'DOC_TOO_LARGE') {
          showError(
            'Save Failed',
            'This brand payload is too large to save atomically. Please trim the setup data and try again.'
          );
          setIsCompleting(false);
          return;
        }

        console.error('❌ Brand creation API failed:', txResult);
        showError(
          'Save Failed',
          'Unable to save your brand. No credits were deducted. Please try again.'
        );
        setIsCompleting(false);
        return;
      }

      console.log('✅ Brand data saved successfully:', brandId);

      // Sync the credit balance shown in the sidebar / UI now that the tx committed.
      await refreshUserProfile();

      // Clear only the keys this onboarding flow set. The previous
      // localStorage.clear() / sessionStorage.clear() wiped unrelated state
      // (theme, selectedBrandId, anything else on the origin).
      sessionStorage.removeItem('brandDomain');
      sessionStorage.removeItem('companyInfo');
      sessionStorage.removeItem('aiInsights');

      // Refresh brands in context and set the new brand as selected
      console.log('🔄 Refreshing brand context...');
      await refetchBrands(); // Refresh the brands list

      // Set the newly created brand as the selected brand
      console.log('✅ Setting new brand as selected:', brandId);
      setSelectedBrandId(brandId);

      console.log('✅ Brand setup completed successfully! (100 credits deducted)');

      // Show comprehensive completion notification
      showSuccess(
        '🎉 Brand Setup Complete!',
        `${companyData.companyName} has been added with ${selectedQueries.size} selected queries. Your first processing is ready to begin!`
      );

      // Show info about next steps
      setTimeout(() => {
        showInfo(
          'Ready to Process Queries',
          'You can now process your queries to see how AI platforms respond to questions about your brand. Each query costs 10 credits.'
        );
      }, 2000);

      console.log('🎯 Redirecting directly to queries page...');

      // Navigate directly to queries page
      router.replace('/dashboard/queries');

    } catch (error) {
      console.error('❌ Error during setup completion:', error);
      // The atomic transaction either committed both writes or neither, so
      // there's no half-finished state to clean up. No refund needed.
      showError(
        'Setup Failed',
        'An unexpected error occurred during brand setup. Please try again or contact support if the issue persists.'
      );
      setIsCompleting(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Awareness': return <Eye className="h-4 w-4" />;
      case 'Interest': return <Lightbulb className="h-4 w-4" />;
      case 'Consideration': return <TrendingUp className="h-4 w-4" />;
      case 'Purchase': return <ShoppingCart className="h-4 w-4" />;
      default: return <Search className="h-4 w-4" />;
    }
  };

  const getCategoryColor = getCategoryPillClasses;

  // Group queries by keyword
  const queriesByKeyword = generatedQueries.reduce((acc, query) => {
    if (!acc[query.keyword]) {
      acc[query.keyword] = [];
    }
    acc[query.keyword].push(query);
    return acc;
  }, {} as Record<string, GeneratedQuery[]>);

  // Filter queries based on selected topic AND intent
  const filteredQueries = generatedQueries.filter(
    (q) =>
      (selectedTopic === 'all' || q.keyword === selectedTopic) &&
      (intentFilter === 'all' || q.category === intentFilter),
  );

  const availableTopics = Array.from(new Set(generatedQueries.map((q) => q.keyword)));

  const filteredQueriesByKeyword = selectedTopic === 'all' 
    ? queriesByKeyword 
    : { [selectedTopic]: queriesByKeyword[selectedTopic] || [] };

  // Declared topics are what the user/onboarding explicitly registered —
  // they're what count against the 10-topic cap.
  const declaredTopics = [...(companyData?.keywords || []), ...additionalTopics];

  // Query-derived topics: keywords that appear on generatedQueries but were
  // never added to brand.keywords (e.g. AI-generated queries with their own
  // categories). We surface these in the sidebar/picker so the user can
  // actually see every topic in use — otherwise a query's topic would
  // invisibly exist only on the row.
  const allTopics = (() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const raw of declaredTopics) {
      const t = typeof raw === 'string' ? raw.trim() : '';
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    for (const q of generatedQueries) {
      const t = typeof q?.keyword === 'string' ? q.keyword.trim() : '';
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    return merged;
  })();
  const totalTopics = declaredTopics.length;
  const canAddMoreTopics = totalTopics < 10;

  const handleAddTopic = () => {
    if (canAddMoreTopics) {
      setShowAddTopicModal(true);
    }
  };

  const handleSaveTopic = () => {
    if (newTopicName.trim() && canAddMoreTopics) {
      const trimmedTopic = newTopicName.trim().toLowerCase();
      
      // Check if topic already exists
      if (!allTopics.some(topic => topic.toLowerCase() === trimmedTopic)) {
        setAdditionalTopics(prev => [...prev, trimmedTopic]);
        setNewTopicName('');
        setShowAddTopicModal(false);
        
        // Update sessionStorage with new topics
        if (companyData) {
          const updatedCompanyData = {
            ...companyData,
            keywords: [...(companyData.keywords || []), trimmedTopic]
          };
          sessionStorage.setItem('companyInfo', JSON.stringify(updatedCompanyData));
        }
      }
    }
  };

  const handleCancelTopic = () => {
    setNewTopicName('');
    setShowAddTopicModal(false);
  };

  // Handle keyboard events for topic modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newTopicName.trim() && canAddMoreTopics) {
      handleSaveTopic();
    } else if (e.key === 'Escape') {
      handleCancelTopic();
    }
  };

  // Query modal handlers
  const handleAddQuery = () => {
    // Seed the modal's topic picker:
    //   - If the sidebar is filtered to a specific topic, pre-select it
    //   - Else if there's at least one topic, default to the first
    //   - Else open directly in "create new topic" mode
    const sidebarTopic = selectedTopic !== 'all' ? selectedTopic : '';
    const firstTopic = allTopics[0] ?? '';
    const initial = sidebarTopic || firstTopic;
    setNewQueryTopic(initial);
    setNewQueryTopicDraft('');
    setIsCreatingNewQueryTopic(!initial);
    setShowAddQueryModal(true);
  };

  const resolveQueryTopic = (): string => {
    if (isCreatingNewQueryTopic) return newQueryTopicDraft.trim().toLowerCase();
    return newQueryTopic.trim();
  };

  // Confirm the typed new-topic draft: register it on the brand's topic list
  // (respecting the 10-topic cap and dedupe), select it, and collapse the
  // input back into the chip view. Also triggered by Enter in the input.
  const handleConfirmNewTopic = () => {
    const draft = newQueryTopicDraft.trim().toLowerCase();
    if (!draft) return;

    const existsAlready = allTopics.some(t => t.toLowerCase() === draft);
    if (existsAlready) {
      // Just select the existing match instead of duplicating.
      setNewQueryTopic(allTopics.find(t => t.toLowerCase() === draft) ?? draft);
      setIsCreatingNewQueryTopic(false);
      setNewQueryTopicDraft('');
      return;
    }

    if (!canAddMoreTopics) {
      showError(
        'Topic limit reached',
        'You already have 10 topics. Remove one before adding a new one.'
      );
      return;
    }

    setAdditionalTopics(prev => [...prev, draft]);
    if (companyData) {
      const updatedCompanyData = {
        ...companyData,
        keywords: [...(companyData.keywords || []), draft],
      };
      sessionStorage.setItem('companyInfo', JSON.stringify(updatedCompanyData));
    }
    setNewQueryTopic(draft);
    setIsCreatingNewQueryTopic(false);
    setNewQueryTopicDraft('');
  };

  const handleSaveQuery = () => {
    const topic = resolveQueryTopic();
    if (!newQuery.trim()) return;
    if (!topic) {
      showError('Topic required', 'Pick an existing topic or create a new one.');
      return;
    }

    // If user created a new topic, register it on the brand's topic list.
    // Respects the 10-topic cap; silently no-ops on duplicates.
    const isNewTopic =
      isCreatingNewQueryTopic &&
      !allTopics.some(t => t.toLowerCase() === topic.toLowerCase());
    if (isNewTopic) {
      if (!canAddMoreTopics) {
        showError(
          'Topic limit reached',
          'You already have 10 topics. Remove one before adding a new one.'
        );
        return;
      }
      setAdditionalTopics(prev => [...prev, topic]);
      if (companyData) {
        const updatedCompanyData = {
          ...companyData,
          keywords: [...(companyData.keywords || []), topic],
        };
        sessionStorage.setItem('companyInfo', JSON.stringify(updatedCompanyData));
      }
    }

    const newQueryObject: GeneratedQuery = {
      keyword: topic,
      query: newQuery.trim(),
      category: selectedCategory,
      containsBrand: newQuery.toLowerCase().includes(companyData?.companyName?.toLowerCase() || '') ? 1 : 0
    };

    const newIndex = generatedQueries.length;
    setGeneratedQueries(prev => [...prev, newQueryObject]);
    setSelectedQueries(prev => new Set(Array.from(prev).concat(newIndex)));

    showSuccess(
      'Query Added Successfully!',
      isNewTopic
        ? `New topic "${topic}" created and query attached.`
        : `Added "${newQuery.trim()}" to "${topic}" under ${selectedCategory.toLowerCase()}.`
    );

    setNewQuery('');
    setSelectedCategory('Awareness');
    setNewQueryTopic('');
    setNewQueryTopicDraft('');
    setIsCreatingNewQueryTopic(false);
    setShowAddQueryModal(false);
  };

  const handleCancelQuery = () => {
    setNewQuery('');
    setSelectedCategory('Awareness');
    setNewQueryTopic('');
    setNewQueryTopicDraft('');
    setIsCreatingNewQueryTopic(false);
    setShowAddQueryModal(false);
  };

  // Handle keyboard events for query modal
  const handleQueryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newQuery.trim()) {
      handleSaveQuery();
    } else if (e.key === 'Escape') {
      handleCancelQuery();
    }
  };

  // Checkbox selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedQueries(new Set(filteredQueries.map((_, index) => 
        generatedQueries.findIndex(q => q === filteredQueries[index])
      )));
    } else {
      // Deselect only the filtered queries
      const filteredIndices = new Set(filteredQueries.map((_, index) => 
        generatedQueries.findIndex(q => q === filteredQueries[index])
      ));
      setSelectedQueries(prev => new Set(Array.from(prev).filter(index => !filteredIndices.has(index))));
    }
  };

  const handleSelectQuery = (queryIndex: number, checked: boolean) => {
    const actualIndex = generatedQueries.findIndex(q => q === filteredQueries[queryIndex]);
    setSelectedQueries(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(actualIndex);
      } else {
        newSet.delete(actualIndex);
      }
      return newSet;
    });
  };

  const areAllFilteredSelected = filteredQueries.length > 0 && filteredQueries.every((_, index) => {
    const actualIndex = generatedQueries.findIndex(q => q === filteredQueries[index]);
    return selectedQueries.has(actualIndex);
  });

  const selectedFilteredCount = filteredQueries.filter((_, index) => {
    const actualIndex = generatedQueries.findIndex(q => q === filteredQueries[index]);
    return selectedQueries.has(actualIndex);
  }).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header with Logo and Step Indicators */}
      <div className="flex flex-col items-center pt-8 pb-6">
        <div className="flex flex-col items-center space-y-2 mb-8">
          {/* Genos Logo */}
          <div className="relative w-48 h-12">
            <Image
              src="/logo_no_background.png"
              alt="Genos Logo"
              width={192}
              height={48}
              className="w-full h-auto"
              priority
            />
          </div>
        </div>

        {/* Step Indicators */}
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

          {/* Step 2 - Completed */}
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-lg font-semibold mb-2">
              ✓
            </div>
            <span className="text-muted-foreground text-sm">Brand</span>
          </div>

          {/* Connector */}
          <div className="w-16 h-px bg-primary"></div>

          {/* Step 3 - Active */}
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-lg font-semibold mb-2">
              3
            </div>
            <span className="text-foreground text-sm font-medium">Queries</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex px-8 w-full">
        {/* Sidebar - Topics */}
        <div className="w-80 flex-shrink-0 mr-8">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm sticky top-8">
            {/* Brand Display */}
            {companyData && (
              <div className="mb-6 pb-4 border-b border-border">
                <div className="flex items-center space-x-3 p-3">
                  <WebLogo domain={domain} size={24} />
                  <span className="text-foreground font-medium truncate">
                    {companyData.companyName}
                  </span>
                </div>
              </div>
            )}

            <h2 className="text-lg font-semibold text-foreground mb-4">Topics</h2>
            
            {/* Add Topic Button */}
            <button 
              onClick={handleAddTopic}
              disabled={!canAddMoreTopics}
              className={`w-full flex items-center justify-center space-x-2 rounded-lg px-4 py-2 mb-6 transition-colors ${
                canAddMoreTopics
                  ? 'text-primary border border-primary hover:bg-primary/5'
                  : 'text-muted-foreground border border-gray-600 cursor-not-allowed'
              }`}
            >
              <Plus className="h-4 w-4" />
              <span>Add a topic</span>
            </button>

            {/* Topics List */}
            <div className="space-y-2">
              {/* All Topics */}
              <div 
                onClick={() => setSelectedTopic('all')}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedTopic === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background border border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className="font-medium">All Topics</span>
                <span className="text-sm font-medium">
                  {generatedQueries.length}
                </span>
              </div>

              {/* Individual Topics/Keywords */}
              {allTopics.map((topic, index) => {
                const topicQueries = generatedQueries.filter(
                  q => typeof q?.keyword === 'string' &&
                    q.keyword.trim().toLowerCase() === topic.toLowerCase()
                );
                return (
                  <div 
                    key={index} 
                    onClick={() => setSelectedTopic(topic)}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedTopic === topic
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <span className="capitalize">{topic}</span>
                    <span className="text-sm font-medium">
                      {topicQueries.length}
                    </span>
                  </div>
                );
              })}
              
              {/* Topic Count */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="text-xs text-muted-foreground">
                  {totalTopics}/10 topics added
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1">
          {/* Main Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">
                  {selectedTopic === 'all' ? 'All Topics' : selectedTopic.charAt(0).toUpperCase() + selectedTopic.slice(1)}
                </h1>
                <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                  <span>📅 Last Queried {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-muted-foreground">
                    {filteredQueries.length}/{generatedQueries.length} queries shown
                  </span>
                </div>
                {generatedQueries.length > 0 && (
                  <button
                    onClick={handleAddQuery}
                    className="inline-flex items-center space-x-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add a prompt</span>
                  </button>
                )}
              </div>
            </div>

            {/* Generate Queries Button */}
            {generatedQueries.length === 0 && (
              <div className="text-center mb-8">
                <button
                  onClick={generateQueries}
                  disabled={isGenerating || !companyData}
                  className="inline-flex items-center space-x-2 bg-primary text-primary-foreground px-8 py-4 rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      <span>Finding Queries...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5" />
                      <span>Find Search Queries</span>
                    </>
                  )}
                </button>
                <p className="text-sm text-muted-foreground mt-2">
                  Finding Queries your Customers are asking AI
                </p>
              </div>
            )}

                         {/* Intent Distribution */}
             {generatedQueries.length > 0 && (
               <div className="space-y-8">
                <div>
                  <h2 className="text-xl font-semibold text-foreground mb-4">Query Intent Distribution</h2>
                  <p className="text-foreground text-sm mb-6">
                    Shows the percentage breakdown of different intents based on the queries sent to the AI.
                  </p>
                  
                  {/* Intent Distribution Bar */}
                  <div className="relative h-8 bg-muted rounded-lg overflow-hidden mb-4">
                    {QUERY_CATEGORIES.map((category, index) => {
                      const count = filteredQueries.filter(q => q.category === category).length;
                      const percentage = filteredQueries.length > 0 ? (count / filteredQueries.length) * 100 : 0;
                      const previousPercentages = QUERY_CATEGORIES
                        .slice(0, index)
                        .reduce((sum, cat) => {
                          const catCount = filteredQueries.filter(q => q.category === cat).length;
                          return sum + (filteredQueries.length > 0 ? (catCount / filteredQueries.length) * 100 : 0);
                        }, 0);

                      return percentage > 0 ? (
                        <div
                          key={category}
                          className={`absolute top-0 h-full ${getCategorySolidClass(category)}`}
                          style={{
                            left: `${previousPercentages}%`,
                            width: `${percentage}%`
                          }}
                        />
                      ) : null;
                    })}
                  </div>

                  {/* Intent Legend */}
                  <div className="flex flex-wrap gap-6 text-sm text-foreground">
                    {QUERY_CATEGORIES.map((category) => {
                      const count = filteredQueries.filter(q => q.category === category).length;
                      const percentage = filteredQueries.length > 0 ? Math.round((count / filteredQueries.length) * 100) : 0;

                      return (
                        <div key={category} className="flex items-center space-x-2">
                          <div className={`w-3 h-3 rounded-full ${getCategorySolidClass(category)}`}></div>
                          <span>
                            {category} - <span className="font-medium">{percentage}%</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                                                 {/* Prompts Table */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">
                      Prompts <span className="text-foreground">({filteredQueries.length})</span>
                    </h3>
                    <div className="flex items-center space-x-2 relative" ref={filterMenuRef}>
                      {/* Intents filter */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenFilter(openFilter === 'intent' ? null : 'intent')}
                          className="flex items-center space-x-2 text-foreground hover:text-primary transition-colors rounded-md px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <span>🎯 Intents{intentFilter !== 'all' ? `: ${intentFilter}` : ''}</span>
                          <span className="text-xs">▼</span>
                        </button>
                        {openFilter === 'intent' && (
                          <div className="absolute right-0 mt-1 bg-card border border-border rounded-md shadow-lg z-10 min-w-[160px] py-1">
                            {(['all', 'Awareness', 'Interest', 'Consideration', 'Purchase'] as const).map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => {
                                  setIntentFilter(option);
                                  setOpenFilter(null);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${
                                  intentFilter === option ? 'bg-muted/30 font-medium text-primary' : 'text-foreground'
                                }`}
                              >
                                {option === 'all' ? 'All Intents' : option}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Topics filter */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenFilter(openFilter === 'topic' ? null : 'topic')}
                          className="flex items-center space-x-2 text-foreground hover:text-primary transition-colors rounded-md px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <span># Topics{selectedTopic !== 'all' ? `: ${selectedTopic}` : ''}</span>
                          <span className="text-xs">▼</span>
                        </button>
                        {openFilter === 'topic' && (
                          <div className="absolute right-0 mt-1 bg-card border border-border rounded-md shadow-lg z-10 min-w-[180px] max-h-64 overflow-y-auto py-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTopic('all');
                                setOpenFilter(null);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${
                                selectedTopic === 'all' ? 'bg-muted/30 font-medium text-primary' : 'text-foreground'
                              }`}
                            >
                              All Topics
                            </button>
                            {availableTopics.map((topic) => (
                              <button
                                key={topic}
                                type="button"
                                onClick={() => {
                                  setSelectedTopic(topic);
                                  setOpenFilter(null);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 truncate ${
                                  selectedTopic === topic ? 'bg-muted/30 font-medium text-primary' : 'text-foreground'
                                }`}
                              >
                                {topic}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Table */}
                  <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                    {/* Table Header */}
                    <div className="grid grid-cols-10 gap-4 p-4 bg-card border-b border-gray-700 text-sm font-semibold text-foreground">
                      <div className="col-span-1">
                        <input 
                          type="checkbox" 
                          className="rounded border-gray-600 bg-gray-700 focus:ring-primary focus:ring-2" 
                          checked={areAllFilteredSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          title={areAllFilteredSelected ? "Deselect all" : "Select all"}
                        />
                      </div>
                      <div className="col-span-6">Prompts <span className="text-foreground">({selectedFilteredCount}/{filteredQueries.length} selected)</span></div>
                      <div className="col-span-2">Topic</div>
                      <div className="col-span-1">Intent</div>
                    </div>
                    
                    {/* Table Body */}
                    <div className="divide-y divide-gray-700">
                      {filteredQueries.map((query, index) => {
                        const actualIndex = generatedQueries.findIndex(q => q === query);
                        const isSelected = selectedQueries.has(actualIndex);
                        
                        return (
                        <div key={index} className="grid grid-cols-10 gap-4 p-4 hover:bg-card transition-colors">
                          <div className="col-span-1">
                            <input 
                              type="checkbox" 
                              className="rounded border-gray-600 bg-gray-700 focus:ring-primary focus:ring-2" 
                              checked={isSelected}
                              onChange={(e) => handleSelectQuery(index, e.target.checked)}
                            />
                          </div>
                          <div className="col-span-6">
                            <p className="text-foreground">
                              {query.query}
                            </p>
                          </div>
                          <div className="col-span-2">
                            <span className="text-muted-foreground capitalize text-sm">
                              {query.keyword}
                            </span>
                          </div>
                          <div className="col-span-1">
                            <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-medium ${getCategoryColor(query.category)}`}>
                              {getCategoryIcon(query.category)}
                              <span>{query.category.charAt(0)}</span>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                                 
              </div>
            )}

            {/* AI Query Status */}
            {queryState.loading && (
              <div className="text-center py-8">
                <div className="inline-flex items-center space-x-2 text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <span>AI is finding queries...</span>
                </div>
              </div>
            )}

            {queryState.error && (
              <div className="text-center py-8">
                <div className="text-red-600 mb-4">
                  Failed to find queries: {queryState.error}
                </div>
                <button
                  onClick={generateQueries}
                  className="inline-flex items-center space-x-2 bg-red-600 text-foreground px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Try Again</span>
                </button>
              </div>
            )}


          </div>

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-8">
            <button
              onClick={() => router.push('/dashboard/add-brand/step-2')}
              className="flex items-center space-x-2 bg-muted text-foreground px-6 py-3 rounded-xl hover:bg-border transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Back</span>
            </button>

                          <button
                onClick={handleComplete}
                disabled={!queryState.result || queryState.loading || selectedQueries.size < 4 || isCompleting || creditsLoading || credits < 100}
                className="flex items-center space-x-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isCompleting ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span>Completing Setup...</span>
                  </>
                ) : creditsLoading ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span>Loading account...</span>
                  </>
                ) : credits < 100 ? (
                  <>
                    <span>Insufficient Credits (Need 100)</span>
                    <Check className="h-5 w-5" />
                  </>
                ) : selectedQueries.size < 4 ? (
                  <>
                    <span>Select at least 4 queries to continue ({selectedQueries.size}/4)</span>
                    <Check className="h-5 w-5" />
                  </>
                ) : (
                  <>
                    <span>Complete Setup ({selectedQueries.size} queries, 100 credits)</span>
                    <Check className="h-5 w-5" />
                  </>
                )}
              </button>
          </div>
        </div>
      </div>

      {/* Brand-already-exists Modal */}
      {existingBrandId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <AlertCircle className="h-6 w-6 text-amber-500" />
              <h3 className="text-lg font-semibold text-foreground">Brand already exists</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-6">
              You've already added <span className="font-medium text-foreground">{domain}</span>.
              Would you like to open the existing brand instead? No credits will be charged.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setExistingBrandId(null)}
                className="px-4 py-2 rounded-lg text-foreground border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const targetId = existingBrandId;
                  setExistingBrandId(null);
                  // Match the success path: clear scratch storage, refresh
                  // brand list, select the existing brand, then navigate.
                  sessionStorage.removeItem('brandDomain');
                  sessionStorage.removeItem('companyInfo');
                  sessionStorage.removeItem('aiInsights');
                  await refetchBrands();
                  setSelectedBrandId(targetId!);
                  router.replace('/dashboard/queries');
                }}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Open existing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Topic Modal */}
      {showAddTopicModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Add a new topic</h3>
              <button
                onClick={handleCancelTopic}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Choose a topic that best fits your business area
              </p>

              {/* Input Field */}
              <div>
                <input
                  type="text"
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={50}
                  placeholder="e.g. Vegan products, Eco-friendly bags"
                  className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
                  autoFocus
                />
              </div>

              {/* Info Message */}
              <div className="flex items-start space-x-2 p-3 bg-muted/30 rounded-lg">
                <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Topics are global and will be used across different features of the platform
                </p>
              </div>

              {/* Topic Count */}
              <div className="text-sm text-muted-foreground">
                {totalTopics}/10 topics added
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={handleCancelTopic}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTopic}
                disabled={!newTopicName.trim() || !canAddMoreTopics}
                className="px-6 py-2 bg-primary text-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save Topic
              </button>
            </div>
          </div>
        </div>
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
                  queries for analytics. {totalTopics}/10 topics used.
                </p>

                {!isCreatingNewQueryTopic && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {allTopics.map(topic => {
                      const selected = newQueryTopic === topic;
                      return (
                        <button
                          key={topic}
                          type="button"
                          onClick={() => setNewQueryTopic(topic)}
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
                      disabled={!canAddMoreTopics}
                      onClick={() => {
                        if (!canAddMoreTopics) return;
                        setIsCreatingNewQueryTopic(true);
                        setNewQueryTopic('');
                      }}
                      className={`px-3 py-1.5 rounded-full text-sm border border-dashed transition-colors ${
                        canAddMoreTopics
                          ? 'border-border text-muted-foreground hover:bg-muted/30'
                          : 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
                      }`}
                    >
                      {canAddMoreTopics ? '+ Create new topic' : '+ Topic limit reached'}
                    </button>
                  </div>
                )}

                {isCreatingNewQueryTopic && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newQueryTopicDraft}
                        onChange={(e) => setNewQueryTopicDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newQueryTopicDraft.trim()) {
                            e.preventDefault();
                            handleConfirmNewTopic();
                          }
                        }}
                        maxLength={50}
                        placeholder="e.g. LLM Observability"
                        className="flex-1 px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleConfirmNewTopic}
                        disabled={!newQueryTopicDraft.trim() || !canAddMoreTopics}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Add
                      </button>
                      {allTopics.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreatingNewQueryTopic(false);
                            setNewQueryTopicDraft('');
                            setNewQueryTopic(allTopics[0] ?? '');
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
                          {selectedCategory === 'Awareness' && (
                            <span className="bg-blue-600 text-foreground text-xs px-2 py-1 rounded-full">
                              AI Suggestion
                            </span>
                          )}
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
                disabled={!newQuery.trim() || !resolveQueryTopic()}
                className="px-6 py-2 bg-blue-600 text-foreground rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Add Query
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 
