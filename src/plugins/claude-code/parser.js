import fs from 'fs/promises';
import path from 'path';

/**
 * Extract tool calls from a message content array.
 *
 * @param {Array} content - The message.content array of content blocks
 * @returns {import('../interface.js').ToolCall[]}
 */
export function extractToolCalls(content) {
  if (!Array.isArray(content)) return [];

  return content
    .filter((b) => b.type === 'tool_use' || b.type === 'tool_result')
    .map((b) => ({
      type: b.type,
      name: b.name || 'unknown',
      inputSize: JSON.stringify(b.input || '').length,
      outputSize: JSON.stringify(b.content || '').length,
      ...(b.type === 'tool_result' && b.is_error ? { isError: true } : {}),
    }));
}

/**
 * Decode a URL-encoded project path segment into a readable name.
 *
 * @param {string} encoded - URL-encoded path string
 * @returns {string} Decoded, human-readable project path
 */
export function decodeProjectPath(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/**
 * Extract the project name from a JSONL file path.
 * Expected structure: ~/.claude/projects/{encoded-project-path}/...
 *
 * @param {string} filePath - Absolute path to the JSONL file
 * @returns {string|undefined}
 */
export function extractProjectName(filePath) {
  const projectsIndex = filePath.indexOf(
    path.join('.claude', 'projects') + path.sep
  );
  if (projectsIndex === -1) return undefined;

  const afterProjects = filePath.slice(
    projectsIndex + path.join('.claude', 'projects').length + path.sep.length
  );
  // The first path segment is the encoded project path
  const firstSeg = afterProjects.split(path.sep)[0];
  if (!firstSeg) return undefined;

  return decodeProjectPath(firstSeg);
}

/**
 * Filter out system-injected content (like ide_opened_file tags) from user messages,
 * keeping only meaningful user input and images.
 */
function filterUserContent(content) {
  if (!Array.isArray(content)) return content;
  return content.filter((block) => {
    if (block.type === 'image') return true;
    if (block.type === 'text' && block.text) {
      // Skip system-injected tags that aren't real user input
      const trimmed = block.text.trim();
      if (trimmed.startsWith('<ide_opened_file>') && trimmed.endsWith('</ide_opened_file>')) return false;
      if (trimmed.startsWith('<system-reminder>') && trimmed.endsWith('</system-reminder>')) return false;
      return true;
    }
    return true;
  });
}

/**
 * Parse a single JSONL line into a TokenEvent.
 *
 * @param {string} line - A single JSON line from the JSONL file
 * @param {string} filePath - The source file path (for project extraction)
 * @returns {import('../interface.js').TokenEvent | null}
 */
export function parseLine(line, filePath) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let record;
  try {
    record = JSON.parse(trimmed);
  } catch (err) {
    console.warn(`Skipping malformed JSON line in ${filePath}: ${err.message}`);
    return null;
  }

  // Skip summary lines or lines without a message
  if (record.type === 'summary' || !record.message) {
    return null;
  }

  const msg = record.message;
  const project = extractProjectName(filePath);

  // Handle user messages: strip base64 images, use record-level fields for id
  if (msg.role === 'user') {
    const content = filterUserContent(msg.content);
    // Skip if no meaningful content after filtering
    if (!content || content.length === 0) return null;
    return {
      id: `claude-code:user:${record.uuid || record.timestamp || Date.now()}`,
      agent: 'claude-code',
      sessionId: record.sessionId || '',
      project,
      timestamp: new Date(record.timestamp || Date.now()),
      role: 'user',
      model: undefined,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content,
    };
  }

  const usage = msg.usage || {};
  const toolCalls = extractToolCalls(msg.content);

  return {
    id: `claude-code:${msg.id}`,
    agent: 'claude-code',
    sessionId: record.sessionId || '',
    project,
    timestamp: new Date(record.timestamp || Date.now()),
    role: msg.role || 'unknown',
    model: msg.model || undefined,
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
      cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    },
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    content: msg.content,
  };
}

/**
 * Parse a Claude Code JSONL file into an array of TokenEvents.
 *
 * @param {string} filePath - Absolute path to the .jsonl file
 * @returns {Promise<import('../interface.js').TokenEvent[]>}
 */
export async function parseJSONLFile(filePath) {
  let data;
  try {
    data = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    console.warn(`Failed to read JSONL file ${filePath}: ${err.message}`);
    return [];
  }

  const lines = data.split('\n');
  const events = [];

  for (const line of lines) {
    const event = parseLine(line, filePath);
    if (event) {
      events.push(event);
    }
  }

  return events;
}
