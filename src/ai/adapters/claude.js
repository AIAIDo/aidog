import Anthropic from '@anthropic-ai/sdk';

/**
 * ClaudeAdapter - AI adapter using Anthropic's Claude API.
 */
export class ClaudeAdapter {
  meta = {
    name: 'claude',
    displayName: 'Claude',
    requiresApiKey: true,
    supportsStreaming: true,
    isLocal: false,
  };

  constructor(config = {}) {
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.maxTokens = config.maxTokens || 4096;
  }

  /**
   * Check if the adapter is available (API key present).
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return Boolean(this.apiKey || process.env.ANTHROPIC_API_KEY);
  }

  /**
   * Run analysis using Claude API.
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
    const apiKey = this.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Please set it in your environment or config.');
    }

    const client = new Anthropic({ apiKey });
    const model = options.model || this.model;
    const maxTokens = options.maxTokens || this.maxTokens;

    if (options.stream && options.onChunk) {
      return this._analyzeStreaming(client, systemPrompt, userPrompt, model, maxTokens, options.onChunk);
    }

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      return textBlock ? textBlock.text : '';
    } catch (error) {
      throw new Error(`Claude API error: ${error.message}`);
    }
  }

  /**
   * @private
   */
  async _analyzeStreaming(client, systemPrompt, userPrompt, model, maxTokens, onChunk) {
    try {
      const stream = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        stream: true,
      });

      let fullText = '';

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text;
          fullText += text;
          onChunk(text);
        }
      }

      return fullText;
    } catch (error) {
      throw new Error(`Claude streaming error: ${error.message}`);
    }
  }
}
