import OpenAI from 'openai';

/**
 * QoderAdapter - AI adapter for Qwen Qoder via DashScope compatible mode.
 */
export class QoderAdapter {
  meta = {
    name: 'qoder',
    displayName: 'Qwen Qoder',
    requiresApiKey: true,
    supportsStreaming: true,
    isLocal: false,
  };

  constructor(config = {}) {
    this.model = config.model || 'qwen-plus';
    this.apiKey = config.apiKey || process.env.QODER_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    this.baseURL = config.baseURL || process.env.QODER_BASE_URL || process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.maxTokens = config.maxTokens || 4096;
  }

  async isAvailable() {
    const apiKey = this.apiKey || process.env.QODER_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    return Boolean(apiKey);
  }

  async analyze(systemPrompt, userPrompt, options = {}) {
    const apiKey = this.apiKey || process.env.QODER_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    const baseURL = this.baseURL || process.env.QODER_BASE_URL || process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    if (!apiKey) {
      throw new Error('QODER_API_KEY / DASHSCOPE_API_KEY / QWEN_API_KEY is not set. Please set one in your environment or config.');
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
      throw new Error(`Qoder API error: ${error.message}`);
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
      throw new Error(`Qoder streaming error: ${error.message}`);
    }
  }
}
