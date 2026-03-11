import OpenAI from 'openai';

/**
 * KimiAdapter - AI adapter for Moonshot Kimi (OpenAI-compatible API).
 */
export class KimiAdapter {
  meta = {
    name: 'kimi',
    displayName: 'Moonshot Kimi',
    requiresApiKey: true,
    supportsStreaming: true,
    isLocal: false,
  };

  constructor(config = {}) {
    this.model = config.model || 'moonshot-v1-8k';
    this.apiKey = config.apiKey || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
    this.baseURL = config.baseURL || process.env.KIMI_BASE_URL || process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1';
    this.maxTokens = config.maxTokens || 4096;
  }

  async isAvailable() {
    const apiKey = this.apiKey || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
    return Boolean(apiKey);
  }

  async analyze(systemPrompt, userPrompt, options = {}) {
    const apiKey = this.apiKey || process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
    const baseURL = this.baseURL || process.env.KIMI_BASE_URL || process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1';
    if (!apiKey) {
      throw new Error('KIMI_API_KEY or MOONSHOT_API_KEY is not set. Please set it in your environment or config.');
    }

    const client = new OpenAI({ apiKey, baseURL });
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
      throw new Error(`Kimi API error: ${error.message}`);
    }
  }

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
      throw new Error(`Kimi streaming error: ${error.message}`);
    }
  }
}
