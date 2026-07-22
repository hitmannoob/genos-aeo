import { z } from 'zod';

export const CompanyInfoInputSchema = z.object({
  domain: z.string().trim().min(1).max(253)
    .describe('The company domain name (e.g., "example.com" or "https://example.com").'),
  clientRequestId: z.string().trim().min(1).max(120)
    .describe('Stable per-request id from the client; used to dedupe credit deduction on retry.'),
});
export type CompanyInfoInput = z.infer<typeof CompanyInfoInputSchema>;

const CompanyInfoListSchema = z.array(z.string().trim().min(1).max(160))
  .max(20)
  .transform((items) => Array.from(new Map(
    items.map((item) => [item.toLowerCase(), item] as const)
  ).values()));

export const CompanyInfoModelOutputSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  shortDescription: z.string().trim().max(2_000),
  productsAndServices: CompanyInfoListSchema,
  keywords: CompanyInfoListSchema,
  competitors: CompanyInfoListSchema,
}).strict().refine(
  (value) => value.shortDescription.length > 0 || value.productsAndServices.length > 0,
  { message: 'The provider response did not contain enough verified company information' }
);

export const CompanyInfoSchema = CompanyInfoModelOutputSchema.safeExtend({
  website: z.string().url().max(2_048).refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'https:' || protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Website must use http or https'),
});
export type CompanyInfo = z.infer<typeof CompanyInfoSchema>;
