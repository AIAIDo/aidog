import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenCodePlugin } from '../../src/plugins/opencode/index.js';
import {
  loadProjectMap,
  loadSessions,
  loadMessagesForSession,
  loadPartsForMessage,
  extractToolCalls,
  messageToTokenEvent,
  parseAllEvents,
} from '../../src/plugins/opencode/parser.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Helper: create a minimal OpenCode storage tree and return its path.
 */
function createTestStorage() {
  const root = mkdtempSync(join(tmpdir(), 'aidog-opencode-test-'));
  const dirs = [
    'project',
    'session/abc123',
    'session/global',
    'message/ses_001',
    'part/msg_asst_001',
  ];
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });

  // Project
  writeFileSync(
    join(root, 'project', 'abc123.json'),
    JSON.stringify({
      id: 'abc123',
      worktree: '/tmp/myproject',
      vcs: 'git',
      time: { created: 1700000000000, updated: 1700001000000 },
    }),
  );

  // Session
  writeFileSync(
    join(root, 'session', 'abc123', 'ses_001.json'),
    JSON.stringify({
      id: 'ses_001',
      slug: 'test-session',
      projectID: 'abc123',
      directory: '/tmp/myproject',
      title: 'Test session',
      time: { created: 1700000000000, updated: 1700001000000 },
      summary: { additions: 0, deletions: 0, files: 0 },
    }),
  );

  // User message (no tokens)
  writeFileSync(
    join(root, 'message', 'ses_001', 'msg_user_001.json'),
    JSON.stringify({
      id: 'msg_user_001',
      sessionID: 'ses_001',
      role: 'user',
      time: { created: 1700000100000 },
      agent: 'build',
      model: { providerID: 'opencode', modelID: 'claude-sonnet-4-5' },
    }),
  );

  // Assistant message (with tokens)
  writeFileSync(
    join(root, 'message', 'ses_001', 'msg_asst_001.json'),
    JSON.stringify({
      id: 'msg_asst_001',
      sessionID: 'ses_001',
      role: 'assistant',
      time: { created: 1700000200000, completed: 1700000210000 },
      parentID: 'msg_user_001',
      modelID: 'claude-sonnet-4-5',
      providerID: 'opencode',
      mode: 'build',
      agent: 'build',
      path: { cwd: '/tmp/myproject', root: '/tmp/myproject' },
      cost: 0,
      tokens: {
        input: 5000,
        output: 200,
        reasoning: 50,
        cache: { read: 1000, write: 100 },
      },
      finish: 'tool-calls',
    }),
  );

  // Parts for assistant message
  writeFileSync(
    join(root, 'part', 'msg_asst_001', 'prt_001.json'),
    JSON.stringify({
      id: 'prt_001',
      sessionID: 'ses_001',
      messageID: 'msg_asst_001',
      type: 'step-start',
    }),
  );

  writeFileSync(
    join(root, 'part', 'msg_asst_001', 'prt_002.json'),
    JSON.stringify({
      id: 'prt_002',
      sessionID: 'ses_001',
      messageID: 'msg_asst_001',
      type: 'text',
      text: 'Let me check that file.',
      time: { start: 1700000201000, end: 1700000201000 },
    }),
  );

  writeFileSync(
    join(root, 'part', 'msg_asst_001', 'prt_003.json'),
    JSON.stringify({
      id: 'prt_003',
      sessionID: 'ses_001',
      messageID: 'msg_asst_001',
      type: 'tool',
      callID: 'call_abc123',
      tool: 'bash',
      state: {
        status: 'completed',
        input: { command: 'cat README.md', description: 'Read README' },
        output: '# My Project\nHello world',
        title: 'Read README',
        metadata: { output: '# My Project\nHello world', exit: 0 },
        time: { start: 1700000202000, end: 1700000205000 },
      },
    }),
  );

  writeFileSync(
    join(root, 'part', 'msg_asst_001', 'prt_004.json'),
    JSON.stringify({
      id: 'prt_004',
      sessionID: 'ses_001',
      messageID: 'msg_asst_001',
      type: 'step-finish',
      reason: 'tool-calls',
      cost: 0,
      tokens: { input: 5000, output: 200, reasoning: 50, cache: { read: 1000, write: 100 } },
    }),
  );

  return root;
}

describe('OpenCodePlugin', () => {
  let plugin;

  beforeEach(() => {
    plugin = new OpenCodePlugin();
  });

  it('should expose valid plugin metadata', () => {
    expect(plugin.meta.name).toBe('opencode');
    expect(plugin.meta.displayName).toBe('OpenCode');
    expect(plugin.meta.version).toBe('0.1.0');
  });

  it('should return a boolean from isAvailable()', async () => {
    const available = await plugin.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});

describe('opencode parser', () => {
  let storageDir;

  beforeEach(() => {
    storageDir = createTestStorage();
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('should load project map correctly', async () => {
    const map = await loadProjectMap(storageDir);
    expect(map.size).toBe(1);
    expect(map.get('abc123')).toEqual({
      worktree: '/tmp/myproject',
      projectName: 'myproject',
    });
  });

  it('should load sessions and correlate with projects', async () => {
    const projectMap = await loadProjectMap(storageDir);
    const sessions = await loadSessions(storageDir, projectMap);

    expect(sessions.size).toBe(1);
    const session = sessions.get('ses_001');
    expect(session).toBeDefined();
    expect(session.title).toBe('Test session');
    expect(session.directory).toBe('/tmp/myproject');
    expect(session.projectName).toBe('myproject');
  });

  it('should load messages for a session sorted by time', async () => {
    const messages = await loadMessagesForSession(storageDir, 'ses_001');
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('msg_user_001');
    expect(messages[1].id).toBe('msg_asst_001');
  });

  it('should load parts for a message', async () => {
    const parts = await loadPartsForMessage(storageDir, 'msg_asst_001');
    expect(parts).toHaveLength(4);
  });

  it('should extract tool calls from parts', async () => {
    const parts = await loadPartsForMessage(storageDir, 'msg_asst_001');
    const toolCalls = extractToolCalls(parts);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].type).toBe('tool_use');
    expect(toolCalls[0].name).toBe('bash');
    expect(toolCalls[0].inputSize).toBeGreaterThan(0);
    expect(toolCalls[0].outputSize).toBeGreaterThan(0);
  });

  it('should convert assistant message to TokenEvent with correct fields', () => {
    const msg = {
      id: 'msg_asst_001',
      sessionID: 'ses_001',
      role: 'assistant',
      time: { created: 1700000200000 },
      modelID: 'claude-sonnet-4-5',
      tokens: { input: 5000, output: 200, reasoning: 50, cache: { read: 1000, write: 100 } },
    };
    const sessionInfo = { directory: '/tmp/myproject', projectName: 'myproject' };
    const toolCalls = [{ type: 'tool_use', name: 'bash', inputSize: 50, outputSize: 100 }];

    const event = messageToTokenEvent(msg, sessionInfo, toolCalls);

    expect(event.id).toBe('opencode:msg_asst_001');
    expect(event.agentName).toBe('opencode');
    expect(event.sessionId).toBe('ses_001');
    expect(event.projectPath).toBe('/tmp/myproject');
    expect(event.projectName).toBe('myproject');
    expect(event.role).toBe('assistant');
    expect(event.model).toBe('claude-sonnet-4-5');
    expect(event.inputTokens).toBe(5050); // 5000 input + 50 reasoning
    expect(event.outputTokens).toBe(200);
    expect(event.cacheReadTokens).toBe(1000);
    expect(event.cacheWriteTokens).toBe(100);
    expect(event.toolCalls).toHaveLength(1);
    expect(event.toolCalls[0].name).toBe('bash');
  });

  it('should parse all events from storage directory', async () => {
    const events = await parseAllEvents(storageDir);

    // Both user and assistant messages should produce events
    expect(events).toHaveLength(2);

    const userEvent = events.find(e => e.role === 'user');
    expect(userEvent).toBeDefined();
    expect(userEvent.inputTokens).toBe(0);
    expect(userEvent.outputTokens).toBe(0);

    const event = events.find(e => e.role === 'assistant');
    expect(event.id).toBe('opencode:msg_asst_001');
    expect(event.agentName).toBe('opencode');
    expect(event.sessionId).toBe('ses_001');
    expect(event.model).toBe('claude-sonnet-4-5');
    expect(event.inputTokens).toBe(5050);
    expect(event.outputTokens).toBe(200);
    expect(event.cacheReadTokens).toBe(1000);
    expect(event.cacheWriteTokens).toBe(100);
    expect(event.toolCalls).toHaveLength(1);
  });

  it('should generate unique event IDs with opencode: prefix', async () => {
    const events = await parseAllEvents(storageDir);
    for (const event of events) {
      expect(event.id).toMatch(/^opencode:/);
    }
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should return empty array for nonexistent storage directory', async () => {
    const events = await parseAllEvents('/nonexistent/path');
    expect(events).toEqual([]);
  });

  it('should return empty results for empty directories', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'aidog-opencode-empty-'));
    mkdirSync(join(emptyDir, 'project'), { recursive: true });
    mkdirSync(join(emptyDir, 'session'), { recursive: true });
    mkdirSync(join(emptyDir, 'message'), { recursive: true });

    const events = await parseAllEvents(emptyDir);
    expect(events).toEqual([]);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('should filter events by since date', async () => {
    const futureDate = new Date(1800000000000); // Far in the future
    const events = await parseAllEvents(storageDir, futureDate);
    expect(events).toEqual([]);
  });

  it('should handle messages without tokens gracefully', () => {
    const msg = {
      id: 'msg_no_tokens',
      sessionID: 'ses_001',
      role: 'assistant',
      time: { created: 1700000000000 },
      modelID: 'some-model',
    };

    const event = messageToTokenEvent(msg, {}, []);
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
    expect(event.cacheReadTokens).toBe(0);
    expect(event.cacheWriteTokens).toBe(0);
  });
});
