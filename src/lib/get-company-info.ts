import { z } from 'zod';

export const CompanyInfoInputSchema = z.object({
  domain: z.string().describe('The company domain name (e.g., "example.com" or "https://example.com").'),
  clientRequestId: z.string().min(1).max(120).optional()
    .describe('Stable per-request id from the client; used to dedupe credit deduction on retry.'),
});
export type CompanyInfoInput = z.infer<typeof CompanyInfoInputSchema>;

export const CompanyInfoSchema = z.object({
  companyName: z.string().describe('The official brand or company name'),
  shortDescription: z.string().describe('A concise 2-3 sentence summary of what the company does'),
  productsAndServices: z.array(z.string()).describe('List of main products, services, features, or offerings'),
  keywords: z.array(z.string()).describe('4-5 relevant keywords or phrases representing core business'),
  competitors: z.array(z.string()).describe('3-5 main competitor companies or brands in the same industry'),
  website: z.string().describe('Company website URL'),
});
export type CompanyInfo = z.infer<typeof CompanyInfoSchema>;
