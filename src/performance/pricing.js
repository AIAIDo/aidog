/**
 * Model pricing configuration.
 * Cost per 1M tokens (USD).
 */
export const MODEL_PRICING = {
  'claude-opus': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1.0 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  'gpt-4-turbo': { input: 10, output: 30, cacheRead: 5, cacheWrite: 10 },
  'gemini-pro': { input: 1.25, output: 5, cacheRead: 0.3, cacheWrite: 1.25 },
  'gemini-flash': { input: 0.075, output: 0.3, cacheRead: 0.02, cacheWrite: 0.075 },
  'deepseek': { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
  default: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

/**
 * Find pricing for a model using prefix matching.
 * @param {string} model
 * @returns {{ input: number, output: number, cacheRead: number, cacheWrite: number }}
 */
export function getModelPricing(model) {
  if (!model) return MODEL_PRICING.default;
  const lower = model.toLowerCase();
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (prefix !== 'default' && lower.includes(prefix)) {
      return pricing;
    }
  }
  return MODEL_PRICING.default;
}

/**
 * Estimate cost in USD for a set of token counts.
 * @param {string} model
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {number} [cacheRead=0]
 * @param {number} [cacheWrite=0]
 * @returns {number} Cost in USD
 */
export function estimateCost(model, inputTokens, outputTokens, cacheRead = 0, cacheWrite = 0) {
  const pricing = getModelPricing(model);
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheRead / 1_000_000) * pricing.cacheRead +
    (cacheWrite / 1_000_000) * pricing.cacheWrite
  );
}

/**
 * Classify a model into a tier.
 * @param {string} model
 * @returns {'premium' | 'standard' | 'economy'}
 */
export function getModelTier(model) {
  if (!model) return 'standard';
  const lower = model.toLowerCase();
  if (lower.includes('opus') || lower.includes('gpt-4-turbo')) return 'premium';
  if (lower.includes('haiku') || lower.includes('mini') || lower.includes('flash')) return 'economy';
  return 'standard';
}
