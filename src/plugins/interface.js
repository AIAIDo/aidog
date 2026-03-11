/**
 * @typedef {Object} PluginMeta
 * @property {string} name - Unique plugin identifier (e.g. 'claude-code')
 * @property {string} displayName - Human-readable name (e.g. 'Claude Code')
 * @property {string} version - Semver version string
 * @property {string} [homepage] - URL to the agent's homepage
 */

/**
 * @typedef {Object} TokenUsage
 * @property {number} input_tokens
 * @property {number} output_tokens
 * @property {number} [cache_creation_input_tokens]
 * @property {number} [cache_read_input_tokens]
 */

/**
 * @typedef {Object} ToolCall
 * @property {string} type - The content block type (e.g. 'tool_use', 'tool_result')
 * @property {string} name - Tool name
 * @property {number} inputSize - Serialized input size in bytes
 * @property {number} outputSize - Serialized output size in bytes
 * @property {boolean} [isError] - true if tool_result indicates error (only for type='tool_result')
 */

/**
 * @typedef {Object} TokenEvent
 * @property {string} id - Unique event ID (e.g. 'claude-code:msg_abc123')
 * @property {string} agent - Agent/plugin name
 * @property {string} sessionId - Session identifier
 * @property {string} [project] - Project name or path
 * @property {Date} timestamp - When the event occurred
 * @property {string} role - Message role (e.g. 'user', 'assistant')
 * @property {string} [model] - Model used (e.g. 'claude-sonnet-4-20250514')
 * @property {TokenUsage} usage - Token usage breakdown
 * @property {ToolCall[]} [toolCalls] - Tool calls in this event
 * @property {*} [content] - Raw message content
 */

/**
 * @interface AgentPlugin
 *
 * All aidog agent plugins must implement this interface.
 *
 * @property {PluginMeta} meta - Plugin metadata
 *
 * @method isAvailable
 * @returns {Promise<boolean>} Whether the agent's data is accessible on this system
 *
 * @method fetchHistory
 * @param {Date} [since] - Only return events after this date
 * @returns {Promise<TokenEvent[]>} Historical token events
 *
 * @method watch
 * @param {(events: TokenEvent[]) => void} callback - Called when new events are detected
 * @returns {() => void} Unsubscribe function to stop watching
 *
 * @method getCurrentSession
 * @returns {Promise<Object|null>} Current session state, or null if none active
 *
 * @method [getDataPaths]
 * @param {Date} [since] - Only return data files modified after this date
 * @returns {Promise<string[]>} Paths to raw data files for security scanning
 */

/**
 * Validates that an object implements the AgentPlugin interface.
 *
 * @param {Object} plugin - The plugin instance to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlugin(plugin) {
  const errors = [];

  if (!plugin.meta || typeof plugin.meta !== 'object') {
    errors.push('Plugin must have a "meta" object');
  } else {
    if (typeof plugin.meta.name !== 'string' || !plugin.meta.name) {
      errors.push('meta.name must be a non-empty string');
    }
    if (typeof plugin.meta.displayName !== 'string' || !plugin.meta.displayName) {
      errors.push('meta.displayName must be a non-empty string');
    }
    if (typeof plugin.meta.version !== 'string' || !plugin.meta.version) {
      errors.push('meta.version must be a non-empty string');
    }
  }

  if (typeof plugin.isAvailable !== 'function') {
    errors.push('Plugin must implement isAvailable() method');
  }
  if (typeof plugin.fetchHistory !== 'function') {
    errors.push('Plugin must implement fetchHistory() method');
  }
  if (typeof plugin.watch !== 'function') {
    errors.push('Plugin must implement watch() method');
  }
  if (typeof plugin.getCurrentSession !== 'function') {
    errors.push('Plugin must implement getCurrentSession() method');
  }

  return { valid: errors.length === 0, errors };
}
