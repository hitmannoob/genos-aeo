import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type {
  BrandAnalyticsData,
  LifetimeBrandAnalytics,
} from '@/lib/analytics/brandAnalytics';
import type { RecommendationData } from '@/lib/recommendation-types';
import type { UserBrand } from '@/types/userBrand';

interface PdfMakeDocument {
  download: (filename: string) => void;
}

interface PdfMakeRuntime {
  createPdf: (definition: TDocumentDefinitions) => PdfMakeDocument;
}

declare global {
  interface Window {
    pdfMake?: PdfMakeRuntime;
  }
}

let pdfMakeLoader: Promise<PdfMakeRuntime> | null = null;

function loadPdfScript(source: string, id: string): Promise<void> {
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing?.dataset.loaded === 'true') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement('script');

    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => {
      reject(new Error('Could not load the local PDF generator.'));
    }, { once: true });

    if (!existing) {
      script.id = id;
      script.src = source;
      script.async = false;
      document.head.appendChild(script);
    }
  });
}

async function getPdfMakeRuntime(): Promise<PdfMakeRuntime> {
  if (typeof window === 'undefined') {
    throw new Error('Dashboard PDFs can only be downloaded in the browser.');
  }

  if (window.pdfMake) return window.pdfMake;

  pdfMakeLoader ??= (async () => {
    await loadPdfScript('/vendor/pdfmake/pdfmake.min.js', 'genos-pdfmake-runtime');
    await loadPdfScript('/vendor/pdfmake/vfs_fonts.js', 'genos-pdfmake-fonts');

    if (!window.pdfMake) {
      throw new Error('The local PDF generator did not initialize.');
    }

    return window.pdfMake;
  })();

  return pdfMakeLoader;
}

export interface DashboardCitationSummary {
  totalCitations: number;
  domainCitations: number;
  brandMentions: number;
  uniqueDomains: number;
  domainCitationRate: number;
  brandMentionRate: number;
  topDomains: Array<[string, number]>;
}

export interface DashboardPdfData {
  brand: UserBrand;
  latestAnalytics?: BrandAnalyticsData | null;
  lifetimeAnalytics?: LifetimeBrandAnalytics | null;
  citationSummary?: DashboardCitationSummary | null;
  recommendations?: RecommendationData[];
  generatedAt?: Date;
}

const COLORS = {
  ink: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  paper: '#FFFFFF',
  soft: '#F8FAFC',
  teal: '#0D9488',
  tealDark: '#115E59',
  tealSoft: '#F0FDFA',
};

function safeText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metric(value: unknown, suffix = ''): string {
  const number = Number(value ?? 0);
  return `${Number.isFinite(number) ? number.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '0'}${suffix}`;
}

function providerName(provider: string): string {
  if (provider === 'chatgpt') return 'ChatGPT';
  if (provider === 'google') return 'Google';
  if (provider === 'perplexity') return 'Perplexity';
  return safeText(provider);
}

function fileStem(value: string): string {
  const stem = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return stem || 'brand';
}

function sectionHeading(title: string, detail?: string): Content {
  return {
    margin: [0, 16, 0, 7],
    stack: [
      {
        columns: [
          { text: safeText(title), style: 'sectionTitle' },
          detail
            ? { text: safeText(detail), style: 'sectionDetail', alignment: 'right' }
            : { text: '' },
        ],
      },
      {
        canvas: [
          { type: 'line', x1: 0, y1: 4, x2: 511, y2: 4, lineWidth: 0.6, lineColor: COLORS.border },
        ],
      },
    ],
  };
}

function metricCell(label: string, value: string, emphasized: boolean): TableCell {
  return {
    margin: [10, 9, 10, 10],
    fillColor: emphasized ? COLORS.tealSoft : COLORS.soft,
    stack: [
      { text: safeText(label).toUpperCase(), style: 'metricLabel' },
      { text: value, style: 'metricValue', margin: [0, 5, 0, 0] },
    ],
  };
}

export function dashboardPdfFilename(brand: UserBrand, generatedAt = new Date()): string {
  return `genos-${fileStem(brand.companyName)}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
}

export function buildDashboardPdfDefinition(data: DashboardPdfData): TDocumentDefinitions {
  const generatedAt = data.generatedAt ?? new Date();
  const analytics = data.lifetimeAnalytics ?? data.latestAnalytics ?? null;
  const content: Content[] = [
    { text: 'GENOS / ANSWER VISIBILITY', style: 'eyebrow' },
    { text: safeText(data.brand.companyName), style: 'reportTitle', margin: [0, 10, 0, 2] },
    {
      columns: [
        { text: safeText(data.brand.domain), style: 'brandDomain' },
        {
          text: generatedAt.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }),
          style: 'reportDate',
          alignment: 'right',
        },
      ],
    },
    {
      canvas: [
        { type: 'line', x1: 0, y1: 10, x2: 511, y2: 10, lineWidth: 3, lineColor: COLORS.teal },
      ],
      margin: [0, 0, 0, 9],
    },
    sectionHeading(
      'Visibility snapshot',
      data.lifetimeAnalytics ? 'Lifetime view' : data.latestAnalytics ? 'Latest run' : 'No processed data'
    ),
    {
      table: {
        widths: ['*', '*', '*'],
        body: [
          [
            metricCell('Visibility score', metric(analytics?.brandVisibilityScore, '%'), true),
            metricCell('Brand mentions', metric(analytics?.totalBrandMentions), true),
            metricCell('Citations', metric(analytics?.totalCitations), true),
          ],
          [
            metricCell('Domain citations', metric(analytics?.totalDomainCitations), false),
            metricCell('Queries processed', metric(analytics?.totalQueriesProcessed), false),
            metricCell('Tracked queries', metric(data.brand.queries?.length ?? 0), false),
          ],
        ],
      },
      layout: {
        hLineWidth: () => 4,
        vLineWidth: () => 4,
        hLineColor: () => COLORS.paper,
        vLineColor: () => COLORS.paper,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
    },
  ];

  if (analytics) {
    content.push(
      sectionHeading('Provider performance', `${metric(analytics.totalQueriesProcessed)} processed queries`),
      {
        table: {
          headerRows: 1,
          widths: ['*', 66, 72, 66, 58],
          body: [
            ['Provider', 'Queries', 'Mentions', 'Citations', 'Owned'].map((text) => ({
              text,
              style: 'tableHeader',
              fillColor: COLORS.ink,
              margin: [6, 5, 6, 5],
            })),
            ...Object.entries(analytics.providerStats ?? {}).map(([provider, stats], index) => [
              { text: providerName(provider), bold: index === 0 },
              metric(stats.queriesProcessed),
              metric(stats.brandMentions),
              metric(stats.citations),
              metric(stats.domainCitations),
            ].map((cell) => ({
              text: typeof cell === 'string' ? cell : cell.text,
              bold: typeof cell === 'string' ? false : cell.bold,
              style: 'tableCell',
              fillColor: index % 2 === 0 ? COLORS.soft : COLORS.paper,
              margin: [6, 5, 6, 5] as [number, number, number, number],
            }))),
          ],
        },
        layout: 'noBorders',
      }
    );
  }

  if (data.citationSummary) {
    const summary = data.citationSummary;
    content.push(
      sectionHeading('Citation signals'),
      {
        table: {
          widths: ['*', '*', '*'],
          body: [[
            metricCell('Owned-domain rate', metric(summary.domainCitationRate, '%'), false),
            metricCell('Brand-reference rate', metric(summary.brandMentionRate, '%'), false),
            metricCell('Unique source domains', metric(summary.uniqueDomains), false),
          ]],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 4,
          vLineColor: () => COLORS.paper,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      }
    );

    if (summary.topDomains.length > 0) {
      content.push(
        { text: 'Most cited domains', style: 'subheading', margin: [0, 11, 0, 5] },
        {
          table: {
            widths: [22, '*', 80],
            body: summary.topDomains.slice(0, 6).map(([domain, count], index) => [
              { text: `${index + 1}.`, style: 'rank' },
              { text: safeText(domain), style: 'domain' },
              { text: `${count} citations`, style: 'tableCell', alignment: 'right' },
            ]),
          },
          layout: {
            hLineWidth: (index) => index === 0 ? 0 : 0.5,
            vLineWidth: () => 0,
            hLineColor: () => COLORS.border,
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
        }
      );
    }
  }

  content.push(sectionHeading('Brand scope'));
  const scopeItems = [
    ['Topics', data.brand.keywords ?? []],
    ['Competitors', data.brand.competitors ?? []],
    ['Products and services', data.brand.productsAndServices ?? []],
  ] as const;
  scopeItems.forEach(([label, values]) => {
    content.push({
      unbreakable: true,
      margin: [0, 0, 0, 9],
      stack: [
        { text: label, style: 'subheading', margin: [0, 0, 0, 3] },
        {
          text: values.length > 0 ? safeText(values.slice(0, 12).join(' / ')) : 'Not configured',
          style: 'body',
        },
      ],
    });
  });

  if ((data.recommendations?.length ?? 0) > 0) {
    content.push(sectionHeading('Recommended next moves', `${data.recommendations?.length ?? 0} live recommendations`));
    data.recommendations?.slice(0, 6).forEach((recommendation, index) => {
      content.push({
        unbreakable: true,
        fillColor: index % 2 === 0 ? COLORS.tealSoft : COLORS.soft,
        margin: [0, 0, 0, 7],
        table: {
          widths: ['*'],
          body: [[{
            margin: [10, 8, 10, 9],
            stack: [
              { text: `${index + 1}. ${safeText(recommendation.title)}`, style: 'recommendationTitle' },
              { text: safeText(recommendation.description), style: 'body', margin: [0, 4, 0, 0] },
            ],
          }]],
        },
        layout: 'noBorders',
      });
    });
  }

  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [42, 48, 42, 46],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 9,
      color: COLORS.ink,
      lineHeight: 1.25,
    },
    background: () => ({
      canvas: [
        { type: 'rect', x: 0, y: 0, w: 20, h: 842, color: COLORS.teal },
      ],
    }),
    footer: (currentPage, pageCount) => ({
      margin: [42, 0, 42, 0],
      stack: [
        {
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 511, y2: 0, lineWidth: 0.6, lineColor: COLORS.border },
          ],
        },
        {
          columns: [
            { text: 'Generated from the live Genos dashboard', style: 'footer', margin: [0, 7, 0, 0] },
            { text: `${currentPage} / ${pageCount}`, style: 'footer', alignment: 'right', margin: [0, 7, 0, 0] },
          ],
        },
      ],
    }),
    content,
    styles: {
      eyebrow: { fontSize: 8, bold: true, color: COLORS.tealDark, characterSpacing: 1.4 },
      reportTitle: { fontSize: 25, bold: true, color: COLORS.ink, lineHeight: 1.05 },
      brandDomain: { fontSize: 10, color: COLORS.muted },
      reportDate: { fontSize: 8.5, color: COLORS.muted },
      sectionTitle: { fontSize: 12, bold: true, color: COLORS.ink },
      sectionDetail: { fontSize: 8, color: COLORS.muted },
      metricLabel: { fontSize: 7, bold: true, color: COLORS.muted, characterSpacing: 0.5 },
      metricValue: { fontSize: 16, bold: true, color: COLORS.ink },
      tableHeader: { fontSize: 7.5, bold: true, color: COLORS.paper },
      tableCell: { fontSize: 8, color: COLORS.ink },
      subheading: { fontSize: 8.5, bold: true, color: COLORS.ink },
      rank: { fontSize: 8, bold: true, color: COLORS.tealDark },
      domain: { fontSize: 8, color: COLORS.ink },
      body: { fontSize: 8.2, color: COLORS.muted, lineHeight: 1.25 },
      recommendationTitle: { fontSize: 8.5, bold: true, color: COLORS.ink },
      footer: { fontSize: 7, color: COLORS.muted },
    },
  };

  return definition;
}

export async function downloadDashboardPdf(data: DashboardPdfData): Promise<void> {
  const generatedAt = data.generatedAt ?? new Date();
  const pdfMake = await getPdfMakeRuntime();
  pdfMake
    .createPdf(buildDashboardPdfDefinition({ ...data, generatedAt }))
    .download(dashboardPdfFilename(data.brand, generatedAt));
}
