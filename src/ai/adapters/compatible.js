import OpenAI from 'openai';

/**
 * CompatibleAdapter - AI adapter for OpenAI-compatible APIs (e.g. DeepSeek, Together, etc.).
 * Reuses the OpenAI SDK with a custom baseURL.
 */
export class CompatibleAdapter {
  meta = {
    name: 'compatible',
    displayName: 'OpenAI Compatible',
    requiresApiKey: true,
    supportsStreaming: true,
    isLocal: false,
  };

  constructor(config = {}) {
    this.model = config.model || 'gpt-3.5-turbo';
    this.apiKey = config.apiKey || process.env.OPENAI_COMPATIBLE_API_KEY;
    this.baseURL = config.baseURL || process.env.OPENAI_COMPATIBLE_BASE_URL;
    this.maxTokens = config.maxTokens || 4096;
  }

  /**
   * Check if the adapter is available.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    const apiKey = this.apiKey || process.env.OPENAI_COMPATIBLE_API_KEY;
    const baseURL = this.baseURL || process.env.OPENAI_COMPATIBLE_BASE_URL;
    return Boolean(apiKey || baseURL);
  }

  /**
   * Run analysis using an OpenAI-compatible API.
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {Object} [options]
   * @param {boolean} [options.stream] - Enable streaming
   * @param {Function} [options.onChunk] - Callback for streaming chunks
   * @param {string} [options.model] - Override default model
   * @param {number} [options.maxTokens] - Override default max tokens
   * @returns {Promise<string>} The AI response text
   */
  async analyze(systemPrompt, userPrompt, options = {}) {
    const apiKey = this.apiKey || process.env.OPENAI_COMPATIBLE_API_KEY;
    const baseURL = this.baseURL || process.env.OPENAI_COMPATIBLE_BASE_URL;

    if (!apiKey && !baseURL) {
      throw new Error(
        'OPENAI_COMPATIBLE_API_KEY or OPENAI_COMPATIBLE_BASE_URL is not set. Please set at least one in your environment or config.'
      );
    }

    const clientOpts = {};
    if (apiKey) clientOpts.apiKey = apiKey;
    if (baseURL) clientOpts.baseURL = baseURL;
    // Some compatible endpoints don't require API keys
    if (!apiKey) clientOpts.apiKey = 'not-required';

    const client = new OpenAI(clientOpts);
    const model = options.model || this.model;
    const maxTokens = options.maxTokens || this.maxTokens;

    if (options.stream && options.onChunk) {
      return this._analyzeStreaming(client, systemPrompt, userPrompt, model, maxTokens, options.onChunk);
    }

    try {
      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      return response.choices[0]?.message?.content || '';
    } catch (error) {
      throw new Error(`OpenAI Compatible API error: ${error.message}`);
    }
  }

  /**
   * @private
   */
  async _analyzeStreaming(client, systemPrompt, userPrompt, model, maxTokens, onChunk) {
    try {
      const stream = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: true,
      });

      let fullText = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onChunk(delta);
        }
      }

      return fullText;
    } catch (error) {
      throw new Error(`OpenAI Compatible streaming error: ${error.message}`);
    }
  }
}
