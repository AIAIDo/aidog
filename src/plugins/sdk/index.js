/**
 * SDK plugin skeleton for aidog.
 *
 * This file is a reference implementation for SDK-based agents that do not
 * write native Claude Code / Codex / Gemini / OpenCode history files.
 *
 * Recommended usage:
 * 1. Copy this file to ~/.aidog/plugins/<your-plugin>/index.js
 * 2. Replace the placeholder hooks with your own SDK event source
 * 3. Return normalized TokenEvent objects from fetchHistory() / watch()
 */

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  return new Date();
}

function normalizeUsage(usage = {}) {
  return {
    input_tokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
    cache_creation_input_tokens: Number(
      usage.cache_creation_input_tokens ?? usage.cacheWriteTokens ?? 0
    ),
    cache_read_input_tokens: Number(
      usage.cache_read_input_tokens ?? usage.cacheReadTokens ?? 0
    ),
  };
}

function normalizeToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((toolCall) => ({
    type: toolCall.type || 'tool_use',
    name: toolCall.name || 'unknown',
    inputSize: Number(toolCall.inputSize ?? toolCall.input_size ?? 0),
    outputSize: Number(toolCall.outputSize ?? toolCall.output_size ?? 0),
    isError: Boolean(toolCall.isError ?? toolCall.is_error ?? false),
  }));
}

/**
 * Convert your SDK/runtime event into aidog's TokenEvent shape.
 *
 * @param {object} rawEvent
 * @param {object} options
 * @param {string} options.agent
 * @param {string} options.defaultModel
 * @returns {import('../interface.js').TokenEvent}
 */
export function createSDKTokenEvent(rawEvent, options = {}) {
  const agent = options.agent || rawEvent.agent || 'sdk-agent';
  const sessionId = rawEvent.sessionId || rawEvent.session_id;

  if (!rawEvent.id) {
    throw new Error('SDK event must include a stable id');
  }
  if (!sessionId) {
    throw new Error('SDK event must include sessionId');
  }

  return {
    id: String(rawEvent.id),
    agent,
    sessionId: String(sessionId),
    project: rawEvent.project || rawEvent.projectName || rawEvent.projectPath || undefined,
    timestamp: toDate(rawEvent.timestamp || rawEvent.createdAt || Date.now()),
    role: rawEvent.role || 'assistant',
    model: rawEvent.model || options.defaultModel,
    usage: normalizeUsage(rawEvent.usage),
    toolCalls: normalizeToolCalls(rawEvent.toolCalls),
    content: rawEvent.content ?? rawEvent.message ?? null,
  };
}

/**
 * Factory for SDK-backed plugins.
 *
 * Replace readHistory / subscribe / getSession with adapters to your own
 * database, log stream, queue, webhook sink, or in-process SDK events.
 */
export class SDKPlugin {
  constructor({
    name = 'sdk-agent',
    displayName = 'SDK Agent',
    version = '0.1.0',
    homepage = null,
    defaultModel = undefined,
    isAvailable = async () => false,
    readHistory = async (_since) => [],
    subscribe = (_callback) => () => {},
    getSession = async () => null,
    getDataPaths = undefined,
  } = {}) {
    this.meta = { name, displayName, version, homepage };
    this.defaultModel = defaultModel;
    this._isAvailable = isAvailable;
    this._readHistory = readHistory;
    this._subscribe = subscribe;
    this._getSession = getSession;
    this._getDataPaths = getDataPaths;
  }

  async isAvailable() {
    return await this._isAvailable();
  }

  async fetchHistory(since) {
    const events = await this._readHistory(since);
    return (events || []).map((event) =>
      createSDKTokenEvent(event, {
        agent: this.meta.name,
        defaultModel: this.defaultModel,
      })
    );
  }

  watch(callback) {
    return this._subscribe((events) => {
      const normalized = (events || []).map((event) =>
        createSDKTokenEvent(event, {
          agent: this.meta.name,
          defaultModel: this.defaultModel,
        })
      );

      if (normalized.length > 0) {
        callback(normalized);
      }
    });
  }

  async getCurrentSession() {
    return await this._getSession();
  }

  async getDataPaths(since) {
    if (typeof this._getDataPaths !== 'function') return [];
    return await this._getDataPaths(since);
  }
}

/**
 * Placeholder instance.
 *
 * Copy this module into ~/.aidog/plugins/<name>/index.js and replace the hooks
 * below with your own implementation.
 */
export default new SDKPlugin({
  name: 'sdk-agent',
  displayName: 'SDK Agent Skeleton',
  homepage: 'https://github.com/AIAIDO/aidog',
});
