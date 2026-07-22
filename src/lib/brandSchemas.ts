import { z } from 'zod';
import { CompanyInfoSchema } from './get-company-info';
import { GeneratedQuerySchema } from './queryGeneration';

const BrandQueryInputSchema = GeneratedQuerySchema.extend({
  selected: z.boolean().optional().default(true),
});

export const BrandCreateDataSchema = CompanyInfoSchema.safeExtend({
  domain: z.string().trim().min(1).max(253),
  queries: z.array(BrandQueryInputSchema).min(4).max(40),
  aiAnalysis: z.object({
    providersUsed: z.array(z.string().trim().min(1).max(80)).max(4),
    totalCost: z.number().finite().nonnegative(),
    completedAt: z.string().datetime(),
    requestId: z.string().trim().min(1).max(200).nullable(),
  }).strict().nullable().optional(),
}).superRefine((value, context) => {
  const keywords = new Set(value.keywords.map((keyword) => keyword.toLowerCase()));
  const seenQueries = new Set<string>();

  value.queries.forEach((query, index) => {
    if (!keywords.has(query.keyword.toLowerCase())) {
      context.addIssue({
        code: 'custom',
        path: ['queries', index, 'keyword'],
        message: 'Query keyword must be present in the brand keyword list',
      });
    }

    const queryKey = query.query.toLowerCase();
    if (seenQueries.has(queryKey)) {
      context.addIssue({
        code: 'custom',
        path: ['queries', index, 'query'],
        message: 'Duplicate queries are not allowed',
      });
    }
    seenQueries.add(queryKey);
  });
});

export const CreateBrandRequestSchema = z.object({
  brandData: BrandCreateDataSchema,
}).strict();

export type BrandCreateData = z.infer<typeof BrandCreateDataSchema>;
