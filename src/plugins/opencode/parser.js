import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createTokenEvent } from '../../types.js';

/**
 * Return the OpenCode storage directory, respecting XDG_DATA_HOME.
 */
export function getStorageDir() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  return path.join(dataHome, 'opencode', 'storage');
}

/**
 * Read and parse a JSON file, returning null on any error.
 */
async function readJSON(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * List JSON files in a directory (non-recursive).
 */
async function listJSONFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Load project hash → { worktree, projectName } mapping.
 * Reads all project/*.json files from the storage directory.
 *
 * @param {string} storageDir
 * @returns {Promise<Map<string, { worktree: string, projectName: string }>>}
 */
export async function loadProjectMap(storageDir) {
  const projectDir = path.join(storageDir, 'project');
  const files = await listJSONFiles(projectDir);
  const map = new Map();

  for (const file of files) {
    const data = await readJSON(file);
    if (!data || !data.id) continue;
    map.set(data.id, {
      worktree: data.worktree || '',
      projectName: data.worktree ? path.basename(data.worktree) : '',
    });
  }

  return map;
}

/**
 * Load all sessions, optionally filtered by update time.
 * Sessions are organized under session/{projectHash}/ses_*.json.
 *
 * @param {string} storageDir
 * @param {Map} projectMap
 * @param {Date} [since]
 * @returns {Promise<Map<string, object>>} Map keyed by session ID
 */
export async function loadSessions(storageDir, projectMap, since) {
  const sessionDir = path.join(storageDir, 'session');
  const sessions = new Map();

  let projectDirs;
  try {
    const entries = await fs.readdir(sessionDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return sessions;
  }

  for (const projDirName of projectDirs) {
    const projPath = path.join(sessionDir, projDirName);
    const files = await listJSONFiles(projPath);
    const project = projectMap.get(projDirName);

    for (const file of files) {
      const data = await readJSON(file);
      if (!data || !data.id) continue;

      if (since && data.time?.updated && data.time.updated < since.getTime()) {
        continue;
      }

      sessions.set(data.id, {
        id: data.id,
        title: data.title || data.slug || '',
        directory: data.directory || project?.worktree || '',
        projectName: project?.projectName || (data.directory ? path.basename(data.directory) : ''),
        projectHash: data.projectID || projDirName,
        createdAt: data.time?.created,
        updatedAt: data.time?.updated,
      });
    }
  }

  return sessions;
}

/**
 * Load all message files for a given session.
 *
 * @param {string} storageDir
 * @param {string} sessionId
 * @returns {Promise<object[]>}
 */
export async function loadMessagesForSession(storageDir, sessionId) {
  const msgDir = path.join(storageDir, 'message', sessionId);
  const files = await listJSONFiles(msgDir);
  const messages = [];

  for (const file of files) {
    const data = await readJSON(file);
    if (data && data.id) messages.push(data);
  }

  // Sort by creation time
  messages.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
  return messages;
}

/**
 * Load all part files for a given message.
 *
 * @param {string} storageDir
 * @param {string} messageId
 * @returns {Promise<object[]>}
 */
export async function loadPartsForMessage(storageDir, messageId) {
  const partDir = path.join(storageDir, 'part', messageId);
  const files = await listJSONFiles(partDir);
  const parts = [];

  for (const file of files) {
    const data = await readJSON(file);
    if (data) parts.push(data);
  }

  return parts;
}

/**
 * Extract tool calls from message parts.
 *
 * @param {object[]} parts
 * @returns {import('../../types.js').ToolCall[]}
 */
export function extractToolCalls(parts) {
  return parts
    .filter((p) => p.type === 'tool')
    .map((p) => ({
      type: 'tool_use',
      name: p.tool || 'unknown',
      inputSize: JSON.stringify(p.state?.input || '').length,
      outputSize: JSON.stringify(p.state?.output || p.state?.metadata?.output || '').length,
    }));
}

/**
 * Convert an OpenCode message + session info into a TokenEvent.
 *
 * @param {object} msg        - Raw message JSON
 * @param {object} sessionInfo - Session metadata from loadSessions()
 * @param {import('../../types.js').ToolCall[]} toolCalls
 * @returns {import('../../types.js').TokenEvent}
 */
export function messageToTokenEvent(msg, sessionInfo, toolCalls) {
  return createTokenEvent({
    agentName: 'opencode',
    sourceMessageId: msg.id,
    sessionId: msg.sessionID,
    projectPath: sessionInfo?.directory || '',
    projectName: sessionInfo?.projectName || '',
    timestamp: new Date(msg.time?.created || 0),
    role: msg.role || 'assistant',
    model: msg.modelID || msg.model?.modelID || '',
    inputTokens: (msg.tokens?.input || 0) + (msg.tokens?.reasoning || 0),
    outputTokens: msg.tokens?.output || 0,
    cacheReadTokens: msg.tokens?.cache?.read || 0,
    cacheWriteTokens: msg.tokens?.cache?.write || 0,
    toolCalls: toolCalls.length > 0 ? toolCalls : [],
    contentLength: 0,
  });
}

/**
 * Parse a single message file and its parts into a TokenEvent.
 *
 * @param {string} storageDir
 * @param {object} msg
 * @param {object} sessionInfo
 * @returns {Promise<import('../../types.js').TokenEvent | null>}
 */
export async function parseMessage(storageDir, msg, sessionInfo) {
  if (msg.role === 'user') {
    return createTokenEvent({
      agentName: 'opencode',
      sourceMessageId: msg.id,
      sessionId: msg.sessionID,
      projectPath: sessionInfo?.directory || '',
      projectName: sessionInfo?.projectName || '',
      timestamp: new Date(msg.time?.created || 0),
      role: 'user',
      model: '',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      contentLength: 0,
    });
  }

  if (msg.role !== 'assistant') return null;

  const parts = await loadPartsForMessage(storageDir, msg.id);
  const toolCalls = extractToolCalls(parts);
  return messageToTokenEvent(msg, sessionInfo, toolCalls);
}

/**
 * Parse all OpenCode events from the storage directory.
 *
 * @param {string} storageDir
 * @param {Date} [since]
 * @returns {Promise<import('../../types.js').TokenEvent[]>}
 */
export async function parseAllEvents(storageDir, since) {
  const projectMap = await loadProjectMap(storageDir);
  const sessions = await loadSessions(storageDir, projectMap, since);
  const events = [];
  const seenIds = new Set();

  for (const [sessionId, sessionInfo] of sessions) {
    const messages = await loadMessagesForSession(storageDir, sessionId);

    for (const msg of messages) {
      if (msg.role !== 'assistant' && msg.role !== 'user') continue;
      if (since && msg.time?.created && msg.time.created < since.getTime()) continue;

      const eventId = `opencode:${msg.id}`;
      if (seenIds.has(eventId)) continue;
      seenIds.add(eventId);

      const event = await parseMessage(storageDir, msg, sessionInfo);
      if (event) events.push(event);
    }
  }

  return events;
}
