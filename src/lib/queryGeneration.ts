import { z } from 'zod';
import { CompanyInfoSchema } from './get-company-info';
import { matchesWord } from './competitor-matching';

export const GeneratedQuerySchema = z.object({
  keyword: z.string().trim().min(1).max(160),
  query: z.string().trim().min(4).max(500),
  category: z.enum(['Awareness', 'Interest', 'Consideration', 'Purchase']),
  containsBrand: z.union([z.literal(0), z.literal(1)]),
}).strict();

export const GeneratedQueriesSchema = z.array(GeneratedQuerySchema).min(4).max(40);

export const QueryGenerationInputSchema = z.object({
  company: CompanyInfoSchema,
  clientRequestId: z.string().trim().min(1).max(160),
}).strict().refine(
  (value) => value.company.keywords.length <= 10,
  { path: ['company', 'keywords'], message: 'At most 10 keywords can be used for query generation' }
);

export type GeneratedQuery = z.infer<typeof GeneratedQuerySchema>;

export function normalizeGeneratedQueries(
  value: unknown,
  companyName: string,
  allowedKeywords: string[]
): GeneratedQuery[] | null {
  const parsed = GeneratedQueriesSchema.safeParse(value);
  if (!parsed.success) return null;

  const keywordsByLowercase = new Map(
    allowedKeywords.map((keyword) => [keyword.trim().toLowerCase(), keyword.trim()] as const)
  );
  const brandNeedle = companyName.trim().toLowerCase();
  const seenQueries = new Set<string>();
  const normalized: GeneratedQuery[] = [];

  for (const item of parsed.data) {
    const canonicalKeyword = keywordsByLowercase.get(item.keyword.toLowerCase());
    const queryKey = item.query.toLowerCase();
    if (!canonicalKeyword || seenQueries.has(queryKey)) continue;

    seenQueries.add(queryKey);
    normalized.push({
      ...item,
      keyword: canonicalKeyword,
      containsBrand: brandNeedle && matchesWord(item.query, companyName) ? 1 : 0,
    });
  }

  const keywordCounts = new Map<string, number>();
  let brandedQueryCount = 0;
  const categories = new Set<string>();
  for (const item of normalized) {
    const key = item.keyword.toLowerCase();
    keywordCounts.set(key, (keywordCounts.get(key) ?? 0) + 1);
    brandedQueryCount += item.containsBrand;
    categories.add(item.category);
  }

  const keywordKeys = Array.from(keywordsByLowercase.keys());
  const keywordDistributionIsValid = keywordKeys.length === 1
    ? (keywordCounts.get(keywordKeys[0]) ?? 0) === 4
    : keywordKeys.every((keyword) => {
        const count = keywordCounts.get(keyword) ?? 0;
        return count >= 2 && count <= 3;
      });
  if (
    normalized.length < 4
    || !keywordDistributionIsValid
    || brandedQueryCount > 2
    || categories.size < Math.min(4, normalized.length)
  ) {
    return null;
  }

  return normalized;
}
