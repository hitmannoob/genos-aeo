import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildDashboardPdfDefinition,
  dashboardPdfFilename,
  type DashboardPdfData,
} from '@/lib/dashboardPdf';

const fixture: DashboardPdfData = {
  generatedAt: new Date('2026-08-04T08:30:00.000Z'),
  brand: {
    id: 'brand_fixture',
    userId: 'local-user',
    domain: 'northstar.example',
    website: 'https://northstar.example',
    companyName: 'Northstar Analytics',
    shortDescription: 'Answer-engine visibility for technical marketing teams.',
    productsAndServices: ['AI visibility monitoring', 'Citation analysis'],
    keywords: ['answer engine optimization', 'AI visibility', 'brand citations'],
    competitors: ['Signal Labs', 'Visibility Cloud'],
    queries: [
      {
        keyword: 'AI visibility',
        query: 'What are the best AI visibility platforms?',
        category: 'Awareness',
        containsBrand: 0,
        selected: true,
      },
      {
        keyword: 'brand citations',
        query: 'How can a brand improve citations in AI answers?',
        category: 'Interest',
        containsBrand: 0,
        selected: true,
      },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
  },
  lifetimeAnalytics: {
    userId: 'local-user',
    brandId: 'brand_fixture',
    brandName: 'Northstar Analytics',
    brandDomain: 'northstar.example',
    totalQueriesProcessed: 42,
    totalProcessingSessions: 6,
    totalBrandMentions: 58,
    brandVisibilityScore: 46.8,
    totalCitations: 124,
    totalDomainCitations: 21,
    allCitations: [],
    providerStats: {
      chatgpt: { queriesProcessed: 42, brandMentions: 25, citations: 46, domainCitations: 9 },
      google: { queriesProcessed: 42, brandMentions: 18, citations: 39, domainCitations: 7 },
      perplexity: { queriesProcessed: 42, brandMentions: 15, citations: 39, domainCitations: 5 },
    },
    insights: {
      topPerformingProvider: 'chatgpt',
      topProviders: ['chatgpt'],
      averageBrandMentionsPerResponse: 0.46,
      averageCitationsPerResponse: 0.98,
      averageBrandMentionsPerQuery: 1.38,
      averageCitationsPerQuery: 2.95,
    },
    calculatedAt: '2026-08-04T08:00:00.000Z',
  },
  citationSummary: {
    totalCitations: 124,
    domainCitations: 21,
    brandMentions: 34,
    uniqueDomains: 47,
    domainCitationRate: 16.9,
    brandMentionRate: 27.4,
    topDomains: [
      ['industry.example', 19],
      ['northstar.example', 17],
      ['research.example', 12],
    ],
  },
  recommendations: [
    {
      id: 'rec-1',
      title: 'Strengthen first-party comparison pages',
      description: 'Publish evidence-led comparisons for the topics where third-party sources dominate citations.',
      priority: 'high',
      category: 'Content',
      imageUrl: '',
      readTime: '4 min',
      rating: 5,
    },
    {
      id: 'rec-2',
      title: 'Close the Google visibility gap',
      description: 'Add concise answer blocks and source-backed claims to pages already ranking for tracked topics.',
      priority: 'medium',
      category: 'Visibility',
      imageUrl: '',
      readTime: '3 min',
      rating: 4,
    },
  ],
};

describe('dashboard PDF', () => {
  it('creates a readable multi-section PDF', async () => {
    const [{ default: pdfMake }, { default: pdfFonts }] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]);
    pdfMake.addVirtualFileSystem(pdfFonts);
    const document = pdfMake.createPdf(buildDashboardPdfDefinition(fixture));
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      try {
        (document as unknown as { getBuffer: (callback: (buffer: Buffer) => void) => void })
          .getBuffer(resolve);
      } catch (error) {
        reject(error);
      }
    });

    expect(bytes.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(20_000);

    const qaOutput = process.env.GENOS_PDF_QA_OUTPUT;
    if (qaOutput) writeFileSync(qaOutput, bytes);
  });

  it('uses a stable, filesystem-safe filename', () => {
    expect(dashboardPdfFilename(fixture.brand, fixture.generatedAt)).toBe(
      'genos-northstar-analytics-2026-08-04.pdf'
    );
  });
});
