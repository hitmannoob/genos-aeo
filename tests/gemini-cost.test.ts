import { describe, expect, it } from 'vitest';
import {
  calculateGeminiCost,
  resolveGeminiPricePer1K,
} from '@/lib/api-providers/gemini-cost';

describe('Gemini cost reporting', () => {
  it('uses the stable default model price and bills thought tokens as output', () => {
    const price = resolveGeminiPricePer1K('gemini-3.1-flash-lite');
    expect(calculateGeminiCost({
      promptTokenCount: 1_000,
      candidatesTokenCount: 400,
      thoughtsTokenCount: 600,
    }, price)).toBeCloseTo(0.00175, 10);
  });

  it('requires explicit rates for custom models and accepts paired overrides', () => {
    expect(resolveGeminiPricePer1K('custom-model')).toBeNull();
    expect(resolveGeminiPricePer1K('custom-model', '0.01', '0.02')).toEqual({
      input: 0.01,
      output: 0.02,
    });
  });
});
