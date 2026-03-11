import { PromptBuilder } from './prompt-builder.js';
import { ConfigDiscovery } from './config-discovery.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { OllamaAdapter } from './adapters/ollama.js';
import { CompatibleAdapter } from './adapters/compatible.js';
import { GeminiAdapter } from './adapters/gemini.js';
import { KimiAdapter } from './adapters/kimi.js';
import { GLMAdapter } from './adapters/glm.js';
import { MinMaxAdapter } from './adapters/minmax.js';
import { QoderAdapter } from './adapters/qoder.js';
import { CliAdapter } from './adapters/cli.js';

/**
 * AIManager - Manages AI adapters for token optimization analysis.
 *
 * Auto-selection priority: config > CLI > Ollama > Claude > OpenAI > Gemini > Kimi > GLM > MiniMax > Qoder
 */
export class AIManager {
  constructor() {
    /** @type {Map<string, Object>} */
    this.adapters = new Map();
    this.promptBuilder = new PromptBuilder();
    this.configDiscovery = new ConfigDiscovery();
    this._config = null;

    // Register built-in adapters
    this.registerAdapter(new CliAdapter());
    this.registerAdapter(new ClaudeAdapter());
    this.registerAdapter(new OpenAIAdapter());
    this.registerAdapter(new OllamaAdapter());
    this.registerAdapter(new CompatibleAdapter());
    this.registerAdapter(new GeminiAdapter());
    this.registerAdapter(new KimiAdapter());
    this.registerAdapter(new GLMAdapter());
    this.registerAdapter(new MinMaxAdapter());
    this.registerAdapter(new QoderAdapter());
  }

  /**
   * Register an AI adapter.
   * @param {Object} adapter - An adapter instance with meta, isAvailable(), and analyze()
   */
  registerAdapter(adapter) {
    if (!adapter.meta?.name) {
      throw new Error('Adapter must have a meta.name property');
    }
    if (typeof adapter.isAvailable !== 'function') {
      throw new Error(`Adapter "${adapter.meta.name}" must implement isAvailable()`);
    }
    if (typeof adapter.analyze !== 'function') {
      throw new Error(`Adapter "${adapter.meta.name}" must implement analyze()`);
    }
    this.adapters.set(adapter.meta.name, adapter);
  }

  /**
   * Get all available adapters (ones that have API keys or are reachable).
   * @returns {Promise<Object[]>} Array of available adapter instances
   */
  async getAvailable() {
    const manualConfigs = await this._getManualConfigs();

    // Build merged adapter map: originals + manual-config overrides
    const allAdapters = new Map(this.adapters);
    for (const [name, cfg] of Object.entries(manualConfigs)) {
      if (cfg && (cfg.apiKey || cfg.baseURL)) {
        const configured = this._createConfiguredAdapter(name, cfg);
        if (configured) allAdapters.set(name, configured);
      }
    }

    const results = await Promise.allSettled(
      Array.from(allAdapters.values()).map(async (adapter) => {
        const available = await this._checkAdapterAvailable(adapter);
        return available ? adapter : null;
      })
    );

    return results
      .filter((r) => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value);
  }

  /**
   * Select a specific adapter by provider name, or auto-detect the best one.
   * Auto-selection priority: config > Ollama > Claude > OpenAI > Gemini > Kimi > GLM > MiniMax > Qoder
   *
   * @param {string} [provider] - Provider name to select, or undefined for auto-detect
   * @returns {Promise<Object>} The selected adapter instance
   */
  async selectAdapter(provider) {
    const manualConfigs = await this._getManualConfigs();

    // If a specific provider is requested, use it
    if (provider) {
      const manualCfg = manualConfigs[provider];

      // Try manual-config adapter first
      if (manualCfg && (manualCfg.apiKey || manualCfg.baseURL)) {
        const configured = this._createConfiguredAdapter(provider, manualCfg);
        if (configured) {
          const isAvail = await this._checkAdapterAvailable(configured);
          if (isAvail) return configured;
        }
      }

      // Fall back to default (env-var-based) adapter
      const adapter = this.adapters.get(provider);
      if (!adapter) {
        const available = Array.from(this.adapters.keys()).join(', ');
        throw new Error(`Unknown AI provider "${provider}". Available: ${available}`);
      }
      const isAvail = await this._checkAdapterAvailable(adapter);
      if (!isAvail) {
        throw new Error(
          `AI provider "${provider}" is not available. Check that the required API key or service is configured.`
        );
      }
      return adapter;
    }

    // Auto-detect: check config for preferred provider
    const config = await this._getConfig();
    if (config.preferredProvider) {
      const manualCfg = manualConfigs[config.preferredProvider];
      const preferred = manualCfg && (manualCfg.apiKey || manualCfg.baseURL)
        ? this._createConfiguredAdapter(config.preferredProvider, manualCfg)
        : this.adapters.get(config.preferredProvider);
      if (preferred) {
        const isAvail = await this._checkAdapterAvailable(preferred);
        if (isAvail) return preferred;
      }
    }

    // Auto-selection priority: CLI > Ollama > Claude > OpenAI > Gemini
    const priority = ['cli', 'ollama', 'claude', 'openai', 'gemini', 'kimi', 'glm', 'minmax', 'qoder', 'compatible'];

    for (const name of priority) {
      const manualCfg = manualConfigs[name];
      const adapter = manualCfg && (manualCfg.apiKey || manualCfg.baseURL)
        ? this._createConfiguredAdapter(name, manualCfg)
        : this.adapters.get(name);
      if (adapter) {
        const isAvail = await this._checkAdapterAvailable(adapter);
        if (isAvail) return adapter;
      }
    }

    throw new Error(
      'No AI provider available. Please set up at least one:\n' +
        '  - Install an agent CLI (claude, gemini, codex, opencode) — uses your existing login\n' +
        '  - ANTHROPIC_API_KEY for Claude\n' +
        '  - OPENAI_API_KEY for OpenAI\n' +
        '  - GEMINI_API_KEY for Gemini\n' +
        '  - KIMI_API_KEY (or MOONSHOT_API_KEY) for Kimi\n' +
        '  - GLM_API_KEY (or ZHIPU_API_KEY) for GLM\n' +
        '  - MINMAX_API_KEY for MiniMax\n' +
        '  - DASHSCOPE_API_KEY (or QODER_API_KEY) for Qwen Qoder\n' +
        '  - Start Ollama locally for local inference\n' +
        '  - Or configure manually in Settings'
    );
  }

  /**
   * Run AI analysis on the provided analysis data.
   * @param {Object} analysisData - Sanitized analysis data
   * @param {Object} [options]
   * @param {string} [options.provider] - Specific provider to use
   * @param {string} [options.model] - Override model
   * @param {boolean} [options.stream] - Enable streaming
   * @param {Function} [options.onChunk] - Streaming chunk callback
   * @returns {Promise<Object>} Parsed AnalysisReport JSON
   */
  async analyze(analysisData, options = {}) {
    const adapter = await this.selectAdapter(options.provider);
    const providerName = adapter.meta.name;

    const { systemPrompt, userPrompt } = this.promptBuilder.build(providerName, analysisData);

    const rawResponse = await adapter.analyze(systemPrompt, userPrompt, {
      stream: options.stream,
      onChunk: options.onChunk,
      model: options.model,
    });

    return this._parseResponse(rawResponse);
  }

  /**
   * Parse AI response as JSON, handling common formatting issues.
   * @private
   * @param {string} rawResponse
   * @returns {Object}
   */
  _parseResponse(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'string') {
      throw new Error('AI returned an empty response.');
    }

    let text = rawResponse.trim();

    // Strip markdown code block wrappers if present
    if (text.startsWith('```json')) {
      text = text.slice(7);
    } else if (text.startsWith('```')) {
      text = text.slice(3);
    }
    if (text.endsWith('```')) {
      text = text.slice(0, -3);
    }
    text = text.trim();

    try {
      return JSON.parse(text);
    } catch (firstError) {
      // Try to extract JSON object from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          // Fall through
        }
      }

      // Return a fallback structure with the raw response
      return {
        issues: [],
        summary: {
          totalPotentialSavings: 0,
          topPriority: 'Unable to parse AI response',
        },
        rawResponse: rawResponse,
        parseError: firstError.message,
      };
    }
  }

  /**
   * Get discovered config (cached).
   * @private
   */
  async _getConfig() {
    if (!this._config) {
      this._config = await this.configDiscovery.discover();
    }
    return this._config;
  }

  /**
   * Read manual provider configs from ~/.aidog/config.json.
   * @private
   * @returns {Promise<Record<string, {apiKey?: string, baseURL?: string, model?: string}>>}
   */
  async _getManualConfigs() {
    try {
      const { readFileSync } = await import('fs');
      const { join } = await import('path');
      const { homedir } = await import('os');
      const cfgPath = join(homedir(), '.aidog', 'config.json');
      const saved = JSON.parse(readFileSync(cfgPath, 'utf-8'));
      return saved.providerConfigs || {};
    } catch {
      return {};
    }
  }

  /**
   * Create a new adapter instance with manual config credentials.
   * @private
   * @param {string} name - Provider name
   * @param {Object} cfg - Manual config (apiKey, baseURL, model)
   * @returns {Object|null} Configured adapter instance
   */
  _createConfiguredAdapter(name, cfg) {
    switch (name) {
      case 'claude':
        return new ClaudeAdapter({ apiKey: cfg.apiKey, model: cfg.model });
      case 'openai':
        return new OpenAIAdapter({ apiKey: cfg.apiKey, model: cfg.model });
      case 'gemini':
        return new GeminiAdapter({ apiKey: cfg.apiKey, model: cfg.model });
      case 'kimi':
        return new KimiAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model });
      case 'glm':
        return new GLMAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model });
      case 'minmax':
        return new MinMaxAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model });
      case 'qoder':
        return new QoderAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model });
      case 'ollama':
        return new OllamaAdapter({ baseUrl: cfg.baseURL, model: cfg.model });
      case 'compatible':
        return new CompatibleAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model });
      case 'cli':
        return new CliAdapter({ agent: cfg.agent });
      default:
        return null;
    }
  }

  /**
   * Guard adapter availability checks with a timeout so one slow provider
   * cannot block discovery or auto-selection.
   * @private
   * @param {Object} adapter
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  async _checkAdapterAvailable(adapter, timeoutMs = 4000) {
    let timeoutId;
    try {
      const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      });

      const result = await Promise.race([
        Promise.resolve(adapter.isAvailable()).catch(() => false),
        timeoutPromise,
      ]);

      return Boolean(result);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

export { PromptBuilder } from './prompt-builder.js';
export { ConfigDiscovery } from './config-discovery.js';
export { ClaudeAdapter } from './adapters/claude.js';
export { OpenAIAdapter } from './adapters/openai.js';
export { OllamaAdapter } from './adapters/ollama.js';
export { CompatibleAdapter } from './adapters/compatible.js';
export { GeminiAdapter } from './adapters/gemini.js';
export { KimiAdapter } from './adapters/kimi.js';
export { GLMAdapter } from './adapters/glm.js';
export { MinMaxAdapter } from './adapters/minmax.js';
export { QoderAdapter } from './adapters/qoder.js';
export { CliAdapter } from './adapters/cli.js';
