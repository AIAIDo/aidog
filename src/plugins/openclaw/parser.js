import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createTokenEvent } from '../../types.js';

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getProjectName(projectPath) {
  if (!projectPath) return '';
  return path.basename(projectPath);
}

function normalizeUsage(source = {}) {
  const usage = source?.usage || source?.tokenUsage || source?.tokens || source || {};
  const cache = usage.cache || source?.cache || {};
  const reasoning = toNumber(
    usage.reasoning_tokens ?? usage.reasoningTokens ?? usage.reasoning ?? usage.thinkingTokens
  );

  return {
    inputTokens: toNumber(
      usage.input_tokens ??
      usage.inputTokens ??
      usage.input ??
      usage.prompt_tokens ??
      usage.promptTokens
    ) + reasoning,
    outputTokens: toNumber(
      usage.output_tokens ??
      usage.outputTokens ??
      usage.output ??
      usage.completion_tokens ??
      usage.completionTokens
    ),
    cacheReadTokens: toNumber(
      usage.cache_read_input_tokens ??
      usage.cacheReadTokens ??
      cache.read ??
      cache.hit_tokens ??
      cache.hitTokens
    ),
    cacheWriteTokens: toNumber(
      usage.cache_creation_input_tokens ??
      usage.cacheWriteTokens ??
      cache.write ??
      cache.create_tokens ??
      cache.createTokens
    ),
  };
}

function extractText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.text) return String(item.text);
        if (item?.content) return extractText(item.content);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (value.content != null) return extractText(value.content);
  }
  return '';
}

function normalizeToolCall(tool) {
  if (!tool || typeof tool !== 'object') return null;
  const input = tool.input ?? tool.args ?? tool.arguments ?? tool.parameters ?? {};
  const output = tool.output ?? tool.result ?? tool.response ?? tool.content ?? '';
  const type = tool.type === 'tool_result' || tool.kind === 'tool_result' ? 'tool_result' : 'tool_use';

  return {
    type,
    name: tool.name || tool.tool || tool.toolName || tool.call?.name || 'unknown',
    input,
    inputSize: JSON.stringify(input || '').length,
    outputSize: JSON.stringify(output || '').length,
    ...(tool.is_error || tool.isError || tool.error ? { isError: true } : {}),
  };
}

function normalizeContentBlocks(content) {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }

  if (!Array.isArray(content)) {
    if (content && typeof content === 'object') {
      if (content.type === 'text' && content.text) return [{ type: 'text', text: String(content.text) }];
      if (content.type === 'tool_use' || content.type === 'tool_result') return [content];
      const text = extractText(content);
      return text ? [{ type: 'text', text }] : [];
    }
    return [];
  }

  return content.flatMap((block) => {
    if (typeof block === 'string') {
      return block ? [{ type: 'text', text: block }] : [];
    }
    if (!block || typeof block !== 'object') return [];
    if (block.type === 'text' && block.text) return [{ type: 'text', text: String(block.text) }];
    if (block.type === 'tool_use') {
      return [{
        type: 'tool_use',
        id: block.id || block.tool_use_id || '',
        name: block.name || block.tool || 'unknown',
        input: block.input ?? {},
      }];
    }
    if (block.type === 'toolCall') {
      return [{
        type: 'tool_use',
        id: block.id || block.tool_use_id || '',
        name: block.name || block.tool || 'unknown',
        input: block.arguments ?? block.input ?? block.args ?? {},
      }];
    }
    if (block.type === 'tool_result') {
      return [{
        type: 'tool_result',
        tool_use_id: block.tool_use_id || block.id || '',
        name: block.name || block.tool || 'unknown',
        content: block.content ?? block.output ?? '',
        ...(block.is_error ? { is_error: true } : {}),
      }];
    }
    if (block.type === 'toolUse') {
      return [{
        type: 'tool_use',
        id: block.id || '',
        name: block.name || block.tool || 'unknown',
        input: block.input ?? block.args ?? {},
      }];
    }
    if (block.type === 'toolResult') {
      return [{
        type: 'tool_result',
        tool_use_id: block.id || '',
        name: block.name || block.tool || 'unknown',
        content: block.content ?? block.result ?? '',
        ...(block.isError ? { is_error: true } : {}),
      }];
    }
    const text = extractText(block);
    return text ? [{ type: 'text', text }] : [];
  });
}

export function extractToolCalls(content, explicitToolCalls = []) {
  const fromContent = normalizeContentBlocks(content)
    .filter((block) => block.type === 'tool_use' || block.type === 'tool_result')
    .map((block) => ({
      type: block.type,
      name: block.name || 'unknown',
      input: block.input,
      inputSize: JSON.stringify(block.input || '').length,
      outputSize: JSON.stringify(block.content || '').length,
      ...(block.is_error ? { isError: true } : {}),
    }));

  const fromExplicit = Array.isArray(explicitToolCalls)
    ? explicitToolCalls.map(normalizeToolCall).filter(Boolean)
    : [];

  if (fromContent.length > 0) return fromContent;
  return fromExplicit;
}

export function normalizeSessionMeta(record, fallbackId = '') {
  if (!record || typeof record !== 'object') return null;

  const sessionId = String(
    record.sessionId ??
    record.session_id ??
    record.id ??
    record.key ??
    fallbackId
  );

  if (!sessionId) return null;

  const usage = normalizeUsage(record);
  const projectPath = String(
    record.projectPath ??
    record.project_path ??
    record.cwd ??
    record.directory ??
    record.worktree ??
    record.path?.cwd ??
    record.sessionMemory?.cwd ??
    ''
  );

  return {
    sessionId,
    title: record.title || record.name || record.summary || '',
    projectPath,
    projectName: record.projectName || record.project_name || getProjectName(projectPath),
    model: record.model || record.modelId || record.model_id || record.providerModel || '',
    createdAt: toMillis(record.createdAt ?? record.created_at ?? record.startTime ?? record.time?.created),
    updatedAt: toMillis(record.updatedAt ?? record.updated_at ?? record.lastUpdated ?? record.time?.updated),
    usage,
  };
}

function extractSessionRecords(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed.sessions)) return parsed.sessions;
  if (parsed.sessions && typeof parsed.sessions === 'object') {
    return Object.entries(parsed.sessions).map(([key, value]) =>
      value && typeof value === 'object' ? { key, ...value } : { key, value }
    );
  }
  return Object.entries(parsed).map(([key, value]) =>
    value && typeof value === 'object' ? { key, ...value } : { key, value }
  );
}

export async function loadSessionIndex(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const records = extractSessionRecords(parsed);
    const sessions = new Map();

    for (const record of records) {
      const meta = normalizeSessionMeta(record, record?.key || '');
      if (meta) sessions.set(meta.sessionId, meta);
    }

    return sessions;
  } catch {
    return new Map();
  }
}

function unwrapMessageRecord(record) {
  if (record?.message && typeof record.message === 'object') {
    return { envelope: record, message: record.message };
  }
  return { envelope: record, message: record };
}

function resolveTimestamp(record, message) {
  return toMillis(
    message?.timestamp ??
    message?.createdAt ??
    message?.created_at ??
    record?.timestamp ??
    record?.createdAt ??
    record?.created_at
  );
}

function resolveSessionId(record, message, state, filePath) {
  const fromRecord = record?.sessionId ?? record?.session_id ?? message?.sessionId ?? message?.session_id;
  if (fromRecord) return String(fromRecord);

  if (record?.type === 'session' || record?.kind === 'session') {
    const meta = normalizeSessionMeta(record);
    if (meta?.sessionId) {
      state.sessionId = meta.sessionId;
      return meta.sessionId;
    }
  }

  if (state.sessionId) return state.sessionId;
  return path.basename(filePath, '.jsonl');
}

function resolveProjectPath(record, message, state, sessionMeta) {
  const projectPath = String(
    message?.projectPath ??
    message?.project_path ??
    message?.cwd ??
    record?.projectPath ??
    record?.project_path ??
    record?.cwd ??
    record?.path?.cwd ??
    state.projectPath ??
    sessionMeta?.projectPath ??
    ''
  );

  if (projectPath) state.projectPath = projectPath;
  return projectPath;
}

function resolveModel(record, message, state, sessionMeta) {
  const model = String(
    message?.model ??
    message?.modelId ??
    message?.model_id ??
    record?.model ??
    record?.modelId ??
    record?.model_id ??
    state.model ??
    sessionMeta?.model ??
    ''
  );

  if (model) state.model = model;
  return model;
}

export function parseLine(line, filePath, state = {}, sessionIndex = new Map(), lineNumber = 0) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let record;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!record || typeof record !== 'object') return null;

  if (record.type === 'session' || record.kind === 'session') {
    const meta = normalizeSessionMeta(record);
    if (meta) {
      state.sessionId = meta.sessionId;
      state.projectPath = meta.projectPath || state.projectPath;
      state.model = meta.model || state.model;
    }
    return null;
  }

  const { envelope, message } = unwrapMessageRecord(record);
  const rawRole = message?.role || envelope?.role;
  const role = rawRole === 'toolResult' ? 'assistant' : rawRole;

  if (role !== 'user' && role !== 'assistant') {
    return null;
  }

  const sessionId = resolveSessionId(envelope, message, state, filePath);
  const sessionMeta = sessionIndex.get(sessionId) || null;
  const projectPath = resolveProjectPath(envelope, message, state, sessionMeta);
  const projectName = sessionMeta?.projectName || getProjectName(projectPath);
  const model = resolveModel(envelope, message, state, sessionMeta);
  const timestamp = resolveTimestamp(envelope, message) || Date.now();
  const usage = normalizeUsage(message?.usage || envelope?.usage || message || {});
  const contentSource = message?.content ?? envelope?.content ?? message?.text ?? envelope?.text;
  const content = normalizeContentBlocks(contentSource);
  const explicitToolCalls = [];

  if (Array.isArray(message?.toolCalls ?? envelope?.toolCalls)) {
    explicitToolCalls.push(...(message?.toolCalls ?? envelope?.toolCalls));
  }

  if (rawRole === 'toolResult') {
    explicitToolCalls.push({
      type: 'tool_result',
      id: message?.toolCallId ?? envelope?.toolCallId ?? '',
      name: message?.toolName ?? envelope?.toolName ?? 'unknown',
      content: message?.content ?? envelope?.content ?? '',
      isError: Boolean(message?.isError ?? envelope?.isError),
    });
  }

  const toolCalls = extractToolCalls(contentSource, explicitToolCalls);

  const sourceMessageId = String(
    message?.id ??
    envelope?.id ??
    `${sessionId}:${lineNumber || timestamp}`
  );

  const event = createTokenEvent({
    agentName: 'openclaw',
    sourceMessageId,
    sessionId,
    projectPath,
    projectName,
    timestamp: new Date(timestamp),
    role,
    model,
    inputTokens: role === 'assistant' ? usage.inputTokens : 0,
    outputTokens: role === 'assistant' ? usage.outputTokens : 0,
    cacheReadTokens: role === 'assistant' ? usage.cacheReadTokens : 0,
    cacheWriteTokens: role === 'assistant' ? usage.cacheWriteTokens : 0,
    toolCalls,
    contentLength: JSON.stringify(content || '').length,
  });

  if (content.length > 0) {
    event.content = content;
  }

  return event;
}

export async function parseJSONLFile(filePath, sessionIndex = new Map()) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const state = {};
    const events = [];

    for (const [index, line] of data.split('\n').entries()) {
      const event = parseLine(line, filePath, state, sessionIndex, index + 1);
      if (event) events.push(event);
    }

    return events;
  } catch {
    return [];
  }
}

async function findFilesByName(dir, targetName) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findFilesByName(fullPath, targetName);
        results.push(...nested);
      } else if (entry.isFile() && entry.name === targetName) {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore directory read failures
  }
  return results;
}

async function listJSONLFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

export async function findSessionStores(openClawRoot = path.join(homedir(), '.openclaw')) {
  const agentsDir = path.join(openClawRoot, 'agents');
  const sessionIndexFiles = await findFilesByName(agentsDir, 'sessions.json');
  return sessionIndexFiles.map((filePath) => ({
    indexPath: filePath,
    sessionsDir: path.dirname(filePath),
  }));
}

export async function parseAllEvents(openClawRoot = path.join(homedir(), '.openclaw'), since) {
  const stores = await findSessionStores(openClawRoot);
  const allEvents = [];
  const seenIds = new Set();

  for (const store of stores) {
    const sessionIndex = await loadSessionIndex(store.indexPath);
    const transcriptFiles = await listJSONLFiles(store.sessionsDir);

    for (const filePath of transcriptFiles) {
      const events = await parseJSONLFile(filePath, sessionIndex);
      for (const event of events) {
        if (since && event.timestamp < since) continue;
        if (seenIds.has(event.id)) continue;
        seenIds.add(event.id);
        allEvents.push(event);
      }
    }
  }

  return allEvents;
}
