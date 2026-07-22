export interface OpenAIUsage {
  input_tokens: number;
  input_tokens_details: {
    cached_tokens: number;
  };
  output_tokens: number;
}

export interface OpenAICostRates {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  webSearchPerCall: number;
}

function safeCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function calculateOpenAICost(
  usage: OpenAIUsage | undefined,
  webSearchCallCount: number,
  rates: OpenAICostRates,
): number {
  const inputTokens = safeCount(usage?.input_tokens);
  const cachedTokens = Math.min(
    inputTokens,
    safeCount(usage?.input_tokens_details?.cached_tokens),
  );
  const outputTokens = safeCount(usage?.output_tokens);
  const billableSearchCalls = Math.max(0, Math.floor(safeCount(webSearchCallCount)));

  return (
    ((inputTokens - cachedTokens) / 1_000_000) * rates.inputPerMillion
    + (cachedTokens / 1_000_000) * rates.cachedInputPerMillion
    + (outputTokens / 1_000_000) * rates.outputPerMillion
    + billableSearchCalls * rates.webSearchPerCall
  );
}
