import { describe, expect, it } from 'vitest';
import { calculateOpenAICost } from '@/lib/api-providers/openai-cost';

const rates = {
  inputPerMillion: 0.75,
  cachedInputPerMillion: 0.075,
  outputPerMillion: 4.5,
  webSearchPerCall: 0.01,
};

describe('OpenAI cost reporting', () => {
  it('separates cached input and bills every web search call', () => {
    const cost = calculateOpenAICost(
      {
        input_tokens: 1_000_000,
        input_tokens_details: { cached_tokens: 200_000 },
        output_tokens: 100_000,
      },
      3,
      rates,
    );

    expect(cost).toBeCloseTo(1.095, 10);
  });

  it('clamps invalid counts and cached tokens to billable bounds', () => {
    const cost = calculateOpenAICost(
      {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 500 },
        output_tokens: 0,
      },
      -2,
      rates,
    );

    expect(cost).toBeCloseTo((100 / 1_000_000) * rates.cachedInputPerMillion, 10);
  });
});
