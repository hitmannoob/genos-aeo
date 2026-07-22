export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

export interface GeminiPricePer1K {
  input: number;
  output: number;
}

function validRate(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function resolveGeminiPricePer1K(
  model: string,
  inputOverride?: string,
  outputOverride?: string,
): GeminiPricePer1K | null {
  const input = validRate(inputOverride);
  const output = validRate(outputOverride);
  if (input !== null && output !== null) return { input, output };

  const normalizedModel = model.replace(/^models\//, '');
  if (normalizedModel === DEFAULT_GEMINI_MODEL) {
    return { input: 0.00025, output: 0.0015 };
  }

  return null;
}

function safeCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function calculateGeminiCost(
  usage: GeminiUsage | undefined,
  price: GeminiPricePer1K | null,
): number {
  if (!usage || !price) return 0;

  const inputTokens = safeCount(usage.promptTokenCount);
  const outputTokens = safeCount(usage.candidatesTokenCount) + safeCount(usage.thoughtsTokenCount);
  return (inputTokens / 1_000) * price.input + (outputTokens / 1_000) * price.output;
}
