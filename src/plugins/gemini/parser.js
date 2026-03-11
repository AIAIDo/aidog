import fs from 'fs/promises';

function safeJsonParse(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract tool call summaries from Gemini toolCalls array.
 */
function extractToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;

  const results = toolCalls.map((tc) => {
    const argsStr = tc.args ? JSON.stringify(tc.args) : '';
    const resultStr = tc.result ? JSON.stringify(tc.result) : '';
    return {
      type: 'tool_use',
      name: tc.name || 'unknown',
      inputSize: argsStr.length,
      outputSize: resultStr.length,
    };
  });

  return results.length > 0 ? results : undefined;
}

/**
 * Normalize Gemini message content to standard content blocks.
 */
function normalizeContent(msg) {
  if (msg.type === 'user') {
    return Array.isArray(msg.content) ? msg.content : undefined;
  }
  // gemini type: content is a string
  if (typeof msg.content === 'string') {
    return [{ type: 'text', text: msg.content }];
  }
  return undefined;
}

/**
 * Parse a Gemini CLI session JSON file into TokenEvent[].
 * @param {string} filePath - Path to session-*.json file
 * @param {string} [projectName] - Optional project name override
 * @returns {Promise<import('../../types.js').TokenEvent[]>}
 */
export async function parseSessionFile(filePath, projectName) {
  let data;
  try {
    data = await fs.readFile(filePath, 'utf-8');
  } catch {
    return [];
  }

  const session = safeJsonParse(data);
  if (!session || !Array.isArray(session.messages)) return [];

  const sessionId = session.sessionId || 'unknown';
  const events = [];

  for (const msg of session.messages) {
    // Emit user messages as separate records
    if (msg.type === 'user') {
      const content = normalizeContent(msg);
      if (content && content.length > 0) {
        events.push({
          id: `gemini:user:${sessionId}:${msg.id || msg.timestamp}`,
          sourceMessageId: msg.id || undefined,
          agent: 'gemini',
          sessionId,
          projectName: projectName || undefined,
          timestamp: new Date(msg.timestamp),
          role: 'user',
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          content,
        });
      }
      continue;
    }

    if (msg.type !== 'gemini') continue;

    const tokens = msg.tokens;
    if (!tokens) continue;

    const inputTokens = toNumber(tokens.input) + toNumber(tokens.thoughts);
    const outputTokens = toNumber(tokens.output);
    const cachedTokens = toNumber(tokens.cached);

    if (inputTokens <= 0 && outputTokens <= 0 && cachedTokens <= 0) continue;

    const content = normalizeContent(msg);
    const toolCalls = extractToolCalls(msg.toolCalls);

    events.push({
      id: `gemini:${sessionId}:${msg.id || msg.timestamp}`,
      sourceMessageId: msg.id || undefined,
      agent: 'gemini',
      sessionId,
      projectName: projectName || undefined,
      timestamp: new Date(msg.timestamp),
      role: 'assistant',
      model: msg.model || undefined,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cachedTokens,
        cache_creation_input_tokens: 0,
      },
      toolCalls,
      content,
    });
  }

  return events;
}
