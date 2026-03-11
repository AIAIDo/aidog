/**
 * GeminiAdapter - AI adapter using Google's Gemini API via native fetch.
 */
export class GeminiAdapter {
  meta = {
    name: 'gemini',
    displayName: 'Gemini',
    requiresApiKey: true,
    supportsStreaming: true,
    isLocal: false,
  };

  constructor(config = {}) {
    this.model = config.model || 'gemini-2.0-flash';
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.timeout = config.timeout || 60000;
  }

  /**
   * Check if the adapter is available (API key present).
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return Boolean(this.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  }

  /**
   * Run analysis using Gemini API.
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {Object} [options]
   * @param {boolean} [options.stream] - Enable streaming
   * @param {Function} [options.onChunk] - Callback for streaming chunks
   * @param {string} [options.model] - Override default model
   * @returns {Promise<string>} The AI response text
   */
  async analyze(systemPrompt, userPrompt, options = {}) {
    const apiKey = this.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is not set. Please set it in your environment or config.');
    }

    const model = options.model || this.model;

    if (options.stream && options.onChunk) {
      return this._analyzeStreaming(apiKey, model, systemPrompt, userPrompt, options.onChunk);
    }

    try {
      const url = `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return text;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Gemini request timed out.');
      }
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  /**
   * @private
   */
  async _analyzeStreaming(apiKey, model, systemPrompt, userPrompt, onChunk) {
    try {
      const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini streaming API returned ${response.status}: ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) {
              fullText += text;
              onChunk(text);
            }
          } catch {
            // Skip malformed SSE data
          }
        }
      }

      return fullText;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Gemini streaming request timed out.');
      }
      throw new Error(`Gemini streaming error: ${error.message}`);
    }
  }
}
