import fs from 'fs/promises';
import path from 'path';

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function extractSessionIdFromFile(filePath) {
  const base = path.basename(filePath);
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : '';
}

function getProjectName(projectPath) {
  if (!projectPath) return undefined;
  return path.basename(projectPath);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function appendTextBlockDedup(pendingContent, text) {
  if (!text) return;
  const normalized = String(text);
  // Check all existing text blocks to avoid duplicates (not just the last one)
  for (const block of pendingContent) {
    if (block.type === 'text' && block.text === normalized) {
      return;
    }
  }
  pendingContent.push({ type: 'text', text: normalized });
}

/**
 * Convert a Codex response_item into normalized content blocks
 * compatible with the Claude content format used by the frontend.
 */
function responseItemToContentBlocks(payload) {
  const item = payload || {};
  const itemType = item.type;
  const role = item.role;

  if (itemType === 'message' && role === 'assistant') {
    const content = item.content || [];
    return content
      .filter(c => c.type === 'output_text' && c.text)
      .map(c => ({ type: 'text', text: c.text }));
  }

  if (itemType === 'message' && role === 'user') {
    const content = item.content || [];
    return content
      .filter(c => c.type === 'input_text' && c.text)
      .map(c => ({ type: 'text', text: c.text }));
  }

  if (itemType === 'function_call') {
    return [{
      type: 'tool_use',
      id: item.call_id || '',
      name: item.name || 'unknown',
      input: item.arguments || '',
    }];
  }

  if (itemType === 'function_call_output') {
    return [{
      type: 'tool_result',
      tool_use_id: item.call_id || '',
      content: item.output || '',
    }];
  }

  return [];
}

/**
 * Extract tool call summaries from accumulated content blocks.
 */
function extractToolCallsFromBlocks(blocks) {
  return blocks
    .filter(b => b.type === 'tool_use' || b.type === 'tool_result')
    .map(b => ({
      type: b.type,
      name: b.name || 'unknown',
      inputSize: b.type === 'tool_use' ? (typeof b.input === 'string' ? b.input : JSON.stringify(b.input || '')).length : 0,
      outputSize: b.type === 'tool_result' ? (typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '')).length : 0,
      ...(b.type === 'tool_result' && b.is_error ? { isError: true } : {}),
    }));
}

export function parseLine(line, filePath, state = {}, lineNumber = 0) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const record = safeJsonParse(trimmed);
  if (!record) return null;

  // Initialize content accumulator
  if (!state.pendingContent) state.pendingContent = [];

  if (record.type === 'session_meta') {
    const payload = record.payload || {};
    state.sessionId = payload.id || state.sessionId || extractSessionIdFromFile(filePath);
    state.projectPath = payload.cwd || state.projectPath;
    state.projectName = getProjectName(state.projectPath) || state.projectName;
    state.modelProvider = payload.model_provider || state.modelProvider;
    return null;
  }

  if (record.type === 'turn_context') {
    const payload = record.payload || {};
    if (payload.model) state.model = payload.model;
    return null;
  }

  // Accumulate content from response_item records
  if (record.type === 'response_item') {
    const payload = record.payload || {};
    const blocks = responseItemToContentBlocks(payload);
    for (const block of blocks) {
      if (block.type === 'text') {
        appendTextBlockDedup(state.pendingContent, block.text);
      } else {
        state.pendingContent.push(block);
      }
    }
    return null;
  }

  if (record.type === 'event_msg') {
    const payload = record.payload || {};
    if (payload.turn_id) {
      state.lastTurnId = payload.turn_id;
    }

    // Accumulate content from agent/user message events
    if (payload.type === 'agent_message' && payload.message) {
      appendTextBlockDedup(state.pendingContent, payload.message);
      return null;
    }
    if (payload.type === 'user_message' && payload.message) {
      const sessionId = state.sessionId || extractSessionIdFromFile(filePath) || 'unknown';
      const ts = record.timestamp || new Date().toISOString();
      return {
        id: `codex:user:${sessionId}:${lineNumber || ts}`,
        agent: 'codex',
        sessionId,
        projectPath: state.projectPath,
        projectName: state.projectName,
        timestamp: new Date(ts),
        role: 'user',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        content: [{ type: 'text', text: payload.message }],
      };
    }

    if (payload.type !== 'token_count') {
      return null;
    }

    const usage = payload.info?.last_token_usage || {};
    const inputTokens = toNumber(usage.input_tokens);
    const outputTokens = toNumber(usage.output_tokens);
    const cachedInputTokens = toNumber(usage.cached_input_tokens);

    if (inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0) {
      return null;
    }

    const sessionId = state.sessionId || extractSessionIdFromFile(filePath) || 'unknown';
    const ts = record.timestamp || new Date().toISOString();

    // Collect accumulated content and reset
    const content = state.pendingContent.length > 0 ? [...state.pendingContent] : undefined;
    const toolCalls = content ? extractToolCallsFromBlocks(content) : undefined;
    state.pendingContent = [];

    return {
      id: `codex:${sessionId}:${lineNumber || ts}`,
      sourceMessageId: state.lastTurnId || undefined,
      agent: 'codex',
      sessionId,
      projectPath: state.projectPath,
      projectName: state.projectName,
      timestamp: new Date(ts),
      role: 'assistant',
      model: state.model || undefined,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cachedInputTokens,
        cache_creation_input_tokens: 0,
      },
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      content,
    };
  }

  return null;
}

export async function parseJSONLFile(filePath) {
  let data;
  try {
    data = await fs.readFile(filePath, 'utf-8');
  } catch {
    return [];
  }

  const state = {};
  const events = [];
  const lines = data.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const event = parseLine(lines[i], filePath, state, i + 1);
    if (event) events.push(event);
  }

  return events;
}
