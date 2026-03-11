import OpenAI from 'openai';

/**
 * OpenAIAdapter - AI adapter using OpenAI's API.
 */
export class OpenAIAdapter {
  meta = {
    name: 'openai',
    displayName: 'OpenAI',
    requiresApiKey: true,
    supportsStreaming: true,
    isLocal: false,
  };

  constructor(config = {}) {
    this.model = config.model || 'gpt-4o';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.maxTokens = config.maxTokens || 4096;
  }

  /**
   * Check if the adapter is available (API key present).
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return Boolean(this.apiKey || process.env.OPENAI_API_KEY);
  }

  /**
   * Run analysis using OpenAI API.
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
    const apiKey = this.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set. Please set it in your environment or config.');
    }

    const client = new OpenAI({ apiKey });
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
      throw new Error(`OpenAI API error: ${error.message}`);
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
      throw new Error(`OpenAI streaming error: ${error.message}`);
    }
  }
}
