import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { QueryProcessingResult } from '@/firebase/firestore/getUserBrands';
import { loadBrandWithQueryResults } from '@/firebase/firestore/brandWithResults';

// Process a single query through AI providers
async function processQuery(queryText: string, context?: string): Promise<any> {
  try {
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error('NEXT_PUBLIC_APP_URL environment variable is not set');
    }
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/user-query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: queryText,
        provider: 'both', // Query both providers
        context: context || 'Please provide a comprehensive and helpful response.'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to query AI providers: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error processing query:', error);
    return {
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Normalize query text for dedupe comparison: trim and lowercase.
function normalizeQueryText(text: string): string {
  return (text ?? '').trim().toLowerCase();
}

// A stored QueryProcessingResult is considered "successfully processed" if
// at least one provider returned a non-empty response without an error.
// This mirrors the success semantics the /api/user-query route uses.
function hasSuccessfulProviderResult(result: QueryProcessingResult | undefined): boolean {
  if (!result?.results) return false;
  const providers: Array<'chatgpt' | 'gemini' | 'perplexity'> = ['chatgpt', 'gemini', 'perplexity'];
  return providers.some(p => {
    const r = result.results[p];
    return !!r && !r.error && typeof r.response === 'string' && r.response.length > 0;
  });
}

// Main handler to process queries for a user's brands
export async function POST(request: NextRequest) {
  try {
    // `forceReprocess: true` bypasses the text-based dedupe that skips
    // queries whose normalized text already has a successful stored result.
    // Default: false (dedupe ON).
    const { brandData, queries, forceReprocess } = await request.json();

    if (!brandData || !queries) {
      return NextResponse.json(
        { error: 'brandData and queries are required' },
        { status: 400 }
      );
    }

    console.log('🚀 Processing queries for brand:', brandData.companyName);

    // Text-based dedupe. Unless caller passes forceReprocess:true, we drop
    // any input query whose normalized text already has a successful stored
    // result on the brand. This prevents inflation when reprocessing uses a
    // fresh processingSessionId (the session-id dedupe in
    // updateBrandWithQueryResults only catches within-session overwrites).
    let queriesToProcess = queries;
    let skippedCount = 0;

    if (!forceReprocess && brandData?.id) {
      try {
        const { brand: loadedBrand } = await loadBrandWithQueryResults(brandData.id);
        const existingResults: QueryProcessingResult[] = loadedBrand?.queryProcessingResults || [];

        // Index existing successful results by normalized query text. If the
        // same normalized text appears multiple times, a single success is
        // enough to mark it as "already processed".
        const processedTexts = new Set<string>();
        for (const r of existingResults) {
          if (hasSuccessfulProviderResult(r)) {
            processedTexts.add(normalizeQueryText(r.query));
          }
        }

        queriesToProcess = queries.filter((q: any) => {
          const norm = normalizeQueryText(q?.query ?? '');
          const alreadyProcessed = norm.length > 0 && processedTexts.has(norm);
          if (alreadyProcessed) skippedCount++;
          return !alreadyProcessed;
        });

        console.log(`🔁 Dedupe: ${skippedCount} of ${queries.length} queries already processed; ${queriesToProcess.length} will run.`);
      } catch (dedupeError) {
        // If dedupe loading fails, fall back to processing everything rather
        // than blocking the user. Log loudly so it shows up in monitoring.
        console.warn('⚠️ Dedupe load failed — proceeding without dedupe:', dedupeError);
        queriesToProcess = queries;
        skippedCount = 0;
      }
    }

    // If every input query was already processed, short-circuit. We do NOT
    // call /api/user-query so no credits are deducted for zero work.
    if (queriesToProcess.length === 0 && queries.length > 0) {
      console.log('⏭️  All queries already processed — returning early without deduction.');
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'All queries already processed',
        brandId: brandData.id,
        brandName: brandData.companyName,
        processed: [],
        queryResults: [],
        errors: [],
        summary: {
          totalQueries: queries.length,
          processedQueries: 0,
          totalErrors: 0,
          skippedDuplicates: skippedCount
        }
      });
    }

    const queryResults: QueryProcessingResult[] = [];
    const errors: any[] = [];

    // Generate unique processing session identifier for this API call.
    // Uses crypto.randomUUID() (Node >= 14.17) to avoid milli-collisions that
    // could happen when two sessions started within the same ms tick under
    // the old Date.now() + Math.random() scheme.
    const processingSessionId = `api_session_${randomUUID()}`;
    // Server-generated ISO timestamp. This lives inside each
    // QueryProcessingResult, which is stored as an array element in the
    // brand's queryProcessingResults — Firestore does NOT allow
    // serverTimestamp() sentinel values inside array elements, so a
    // server-computed ISO string is the canonical choice here.
    const processingSessionTimestamp = new Date().toISOString();

    console.log(`🔄 Starting API processing session: ${processingSessionId} at ${processingSessionTimestamp}`);

    // Process each (non-deduped) query
    for (const query of queriesToProcess) {
      try {
        console.log(`  📝 Processing query: "${query.query.substring(0, 50)}..."`);

        // Process through AI providers
        const aiResult = await processQuery(
          query.query,
          `This query is related to ${brandData.companyName} in the ${query.category} category. Topic: ${query.keyword}.`
        );

        console.log(`  📊 AI Result for query:`, {
          query: query.query.substring(0, 50),
          hasResults: !!aiResult.results,
          resultsCount: aiResult.results?.length,
          error: aiResult.error
        });

        // Format the results
        const queryResult: QueryProcessingResult = {
          date: new Date().toISOString(),
          processingSessionId,
          processingSessionTimestamp,
          query: query.query,
          keyword: query.keyword,
          category: query.category,
          results: {}
        };

        // Process the results array from the API
        if (aiResult.results && Array.isArray(aiResult.results)) {
          aiResult.results.forEach((result: any) => {
            if (result.provider === 'openai') {
              queryResult.results.chatgpt = {
                response: result.response || '',
                error: result.error,
                timestamp: result.timestamp || new Date().toISOString(),
                responseTime: undefined,
                tokenCount: undefined
              };
            } else if (result.provider === 'gemini') {
              queryResult.results.gemini = {
                response: result.response || '',
                error: result.error,
                timestamp: result.timestamp || new Date().toISOString(),
                responseTime: undefined,
                tokenCount: undefined
              };
            }
          });
        }

        // TODO: Add Perplexity when available
        // queryResult.results.perplexity = { ... };

        queryResults.push(queryResult);

        // Add a small delay between queries to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`  ❌ Error processing query: ${error}`);
        errors.push({
          query: query.query,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log('✅ Processing complete:', {
      totalQueries: queries.length,
      processedQueries: queryResults.length,
      skippedDuplicates: skippedCount,
      errors: errors.length
    });

    // Return the results for the client to update Firestore
    return NextResponse.json({
      success: true,
      brandId: brandData.id,
      brandName: brandData.companyName,
      queryResults,
      errors,
      summary: {
        totalQueries: queries.length,
        processedQueries: queryResults.length,
        totalErrors: errors.length,
        skippedDuplicates: skippedCount
      }
    });

  } catch (error) {
    console.error('❌ Error in process-user-queries:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

