import OpenAI from 'openai';

/**
 * GLMAdapter - AI adapter for Zhipu GLM (OpenAI-compatible API).
 */
export class GLMAdapter {
  meta = {
    name: 'glm',
    displayName: 'Zhipu GLM',
    requiresApiKey: true,
    supportsStreaming: true,
    isLocal: false,
  };

  constructor(config = {}) {
    this.model = config.model || 'glm-4-flash';
    this.apiKey = config.apiKey || process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY;
    this.baseURL = config.baseURL || process.env.GLM_BASE_URL || process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
    this.maxTokens = config.maxTokens || 4096;
  }

  async isAvailable() {
    const apiKey = this.apiKey || process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY;
    return Boolean(apiKey);
  }

  async analyze(systemPrompt, userPrompt, options = {}) {
    const apiKey = this.apiKey || process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY;
    const baseURL = this.baseURL || process.env.GLM_BASE_URL || process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
    if (!apiKey) {
      throw new Error('GLM_API_KEY or ZHIPU_API_KEY is not set. Please set it in your environment or config.');
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
      throw new Error(`GLM API error: ${error.message}`);
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
      throw new Error(`GLM streaming error: ${error.message}`);
    }
  }
}
