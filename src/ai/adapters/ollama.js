/**
 * OllamaAdapter - AI adapter using local Ollama instance via native fetch.
 */
export class OllamaAdapter {
  meta = {
    name: 'ollama',
    displayName: 'Ollama (Local)',
    requiresApiKey: false,
    supportsStreaming: true,
    isLocal: true,
  };

  constructor(config = {}) {
    this.model = config.model || 'llama3';
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.timeout = config.timeout || 120000;
  }

  /**
   * Check if Ollama is running locally.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Run analysis using Ollama API.
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {Object} [options]
   * @param {boolean} [options.stream] - Enable streaming
   * @param {Function} [options.onChunk] - Callback for streaming chunks
   * @param {string} [options.model] - Override default model
   * @returns {Promise<string>} The AI response text
   */
  async analyze(systemPrompt, userPrompt, options = {}) {
    const model = options.model || this.model;
    const stream = Boolean(options.stream && options.onChunk);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream,
          options: {
            temperature: 0.3,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API returned ${response.status}: ${errorText}`);
      }

      if (stream) {
        return this._readStream(response, options.onChunk);
      }

      const data = await response.json();
      return data.message?.content || '';
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Ollama request timed out. Ensure Ollama is running and the model is available.');
      }
      throw new Error(`Ollama API error: ${error.message}`);
    }
  }

  /**
   * Read NDJSON streaming response from Ollama.
   * @private
   */
  async _readStream(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              fullText += data.message.content;
              onChunk(data.message.content);
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.message?.content) {
            fullText += data.message.content;
            onChunk(data.message.content);
          }
        } catch {
          // Skip malformed trailing data
        }
      }

      return fullText;
    } finally {
      reader.releaseLock();
    }
  }
}
