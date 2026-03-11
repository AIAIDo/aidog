import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { OpenClawPlugin } from '../../src/plugins/openclaw/index.js';
import {
  extractToolCalls,
  findSessionStores,
  loadSessionIndex,
  normalizeSessionMeta,
  parseAllEvents,
  parseJSONLFile,
  parseLine,
} from '../../src/plugins/openclaw/parser.js';

function createTestStore() {
  const root = mkdtempSync(join(tmpdir(), 'aidog-openclaw-test-'));
  const sessionsDir = join(root, 'agents', 'agent-local', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });

  writeFileSync(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      sessions: [
        {
          sessionId: 'sess_openclaw_1',
          title: 'Fix parser',
          cwd: '/tmp/openclaw-project',
          model: 'claude-3-opus',
          createdAt: '2026-03-10T09:59:00.000Z',
          updatedAt: '2026-03-10T10:02:00.000Z',
          usage: {
            inputTokens: 140,
            outputTokens: 28,
            cacheReadTokens: 12,
            cacheWriteTokens: 4,
          },
        },
      ],
    })
  );

  const lines = [
    JSON.stringify({
      type: 'session',
      sessionId: 'sess_openclaw_1',
      cwd: '/tmp/openclaw-project',
      model: 'claude-3-opus',
    }),
    JSON.stringify({
      type: 'message',
      id: 'msg_user_1',
      sessionId: 'sess_openclaw_1',
      role: 'user',
      timestamp: '2026-03-10T10:00:00.000Z',
      content: 'Read the parser and fix the bug',
    }),
    JSON.stringify({
      type: 'message',
      id: 'msg_asst_1',
      sessionId: 'sess_openclaw_1',
      role: 'assistant',
      timestamp: '2026-03-10T10:00:10.000Z',
      model: 'claude-3-opus',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 10,
        cacheWriteTokens: 2,
      },
      content: [
        { type: 'text', text: 'Inspecting the parser now.' },
        { type: 'tool_use', name: 'read', input: { file_path: 'src/parser.js' } },
        { type: 'tool_result', name: 'read', content: 'parser content' },
      ],
    }),
    JSON.stringify({
      type: 'message',
      id: 'msg_tool_result_1',
      sessionId: 'sess_openclaw_1',
      role: 'toolResult',
      toolCallId: 'tool_read_1',
      toolName: 'read',
      isError: false,
      timestamp: '2026-03-10T10:00:20.000Z',
      content: [{ type: 'text', text: 'parser content' }],
    }),
    JSON.stringify({
      message: {
        id: 'msg_asst_2',
        sessionId: 'sess_openclaw_1',
        role: 'assistant',
        timestamp: '2026-03-10T10:01:10.000Z',
        model: 'claude-3-opus',
        usage: {
          input_tokens: 40,
          output_tokens: 8,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
        toolCalls: [
          {
            name: 'exec',
            args: { command: 'npm test' },
            result: 'ok',
          },
        ],
        content: [{ type: 'text', text: 'Tests pass.' }],
      },
    }),
  ];

  writeFileSync(join(sessionsDir, 'sess_openclaw_1.jsonl'), lines.join('\n'));
  return root;
}

describe('OpenClawPlugin', () => {
  let root;
  let plugin;

  beforeEach(() => {
    root = createTestStore();
    process.env.AIDOG_OPENCLAW_HOME = root;
    plugin = new OpenClawPlugin();
  });

  afterEach(() => {
    delete process.env.AIDOG_OPENCLAW_HOME;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('should expose valid plugin metadata', () => {
    expect(plugin.meta.name).toBe('openclaw');
    expect(plugin.meta.displayName).toBe('OpenClaw');
    expect(plugin.meta.version).toBe('0.1.0');
  });

  it('should detect availability from the local session store', async () => {
    await expect(plugin.isAvailable()).resolves.toBe(true);
  });

  it('should return current session summary from sessions.json and transcript data', async () => {
    const session = await plugin.getCurrentSession();
    expect(session.sessionId).toBe('sess_openclaw_1');
    expect(session.project).toBe('openclaw-project');
    expect(session.model).toBe('claude-3-opus');
    expect(session.eventCount).toBe(4);
    expect(session.usage.input_tokens).toBe(140);
    expect(session.usage.output_tokens).toBe(28);
  });
});

describe('openclaw parser', () => {
  let root;
  let sessionsDir;

  beforeEach(() => {
    root = createTestStore();
    sessionsDir = join(root, 'agents', 'agent-local', 'sessions');
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('should normalize session metadata from sessions.json', () => {
    const meta = normalizeSessionMeta({
      sessionId: 's1',
      cwd: '/tmp/demo',
      model: 'gpt-4o',
      updatedAt: '2026-03-10T10:00:00.000Z',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    expect(meta.sessionId).toBe('s1');
    expect(meta.projectPath).toBe('/tmp/demo');
    expect(meta.projectName).toBe('demo');
    expect(meta.model).toBe('gpt-4o');
    expect(meta.usage.inputTokens).toBe(10);
  });

  it('should load sessions from session index', async () => {
    const sessions = await loadSessionIndex(join(sessionsDir, 'sessions.json'));
    expect(sessions.size).toBe(1);
    expect(sessions.get('sess_openclaw_1').projectName).toBe('openclaw-project');
  });

  it('should extract tool calls from content blocks and explicit calls', () => {
    const fromContent = extractToolCalls([
      { type: 'tool_use', name: 'read', input: { file_path: 'a.js' } },
      { type: 'tool_result', name: 'read', content: 'ok' },
    ]);
    const fromExplicit = extractToolCalls([], [
      { name: 'exec', args: { command: 'pwd' }, result: '/tmp/demo' },
    ]);

    expect(fromContent).toHaveLength(2);
    expect(fromContent[0].name).toBe('read');
    expect(fromExplicit).toHaveLength(1);
    expect(fromExplicit[0].name).toBe('exec');
  });

  it('should parse transcript lines into normalized token events', async () => {
    const sessionIndex = await loadSessionIndex(join(sessionsDir, 'sessions.json'));
    const filePath = join(sessionsDir, 'sess_openclaw_1.jsonl');
    const events = await parseJSONLFile(filePath, sessionIndex);

    expect(events).toHaveLength(4);
    expect(events[0].role).toBe('user');
    expect(events[0].projectName).toBe('openclaw-project');
    expect(events[1].id).toBe('openclaw:msg_asst_1');
    expect(events[1].inputTokens).toBe(100);
    expect(events[1].toolCalls).toHaveLength(2);
    expect(events[1].toolCalls[0].name).toBe('read');
    expect(events[2].toolCalls).toHaveLength(1);
    expect(events[2].toolCalls[0].type).toBe('tool_result');
    expect(events[2].toolCalls[0].name).toBe('read');
    expect(events[3].toolCalls).toHaveLength(1);
    expect(events[3].toolCalls[0].name).toBe('exec');
  });

  it('should parse a single wrapped message line', async () => {
    const sessionIndex = await loadSessionIndex(join(sessionsDir, 'sessions.json'));
    const event = parseLine(
      JSON.stringify({
        message: {
          id: 'msg_wrapped_1',
          sessionId: 'sess_openclaw_1',
          role: 'assistant',
          timestamp: '2026-03-10T10:03:00.000Z',
          content: [{ type: 'text', text: 'Wrapped line' }],
          usage: { input_tokens: 12, output_tokens: 3 },
        },
      }),
      join(sessionsDir, 'sess_openclaw_1.jsonl'),
      {},
      sessionIndex,
      1
    );

    expect(event.id).toBe('openclaw:msg_wrapped_1');
    expect(event.inputTokens).toBe(12);
    expect(event.content[0].text).toBe('Wrapped line');
  });

  it('should parse OpenClaw toolCall blocks in assistant content', async () => {
    const sessionIndex = await loadSessionIndex(join(sessionsDir, 'sessions.json'));
    const event = parseLine(
      JSON.stringify({
        type: 'message',
        id: 'msg_tool_use_1',
        sessionId: 'sess_openclaw_1',
        role: 'assistant',
        timestamp: '2026-03-10T10:05:00.000Z',
        content: [
          {
            type: 'toolCall',
            id: 'tool_exec_1',
            name: 'exec',
            arguments: { command: 'pwd' },
          },
        ],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
      join(sessionsDir, 'sess_openclaw_1.jsonl'),
      {},
      sessionIndex,
      1
    );

    expect(event.toolCalls).toHaveLength(1);
    expect(event.toolCalls[0].type).toBe('tool_use');
    expect(event.toolCalls[0].name).toBe('exec');
  });

  it('should parse OpenClaw toolResult messages as tool_result events', async () => {
    const sessionIndex = await loadSessionIndex(join(sessionsDir, 'sessions.json'));
    const event = parseLine(
      JSON.stringify({
        type: 'message',
        id: 'msg_tool_res_1',
        sessionId: 'sess_openclaw_1',
        role: 'toolResult',
        toolCallId: 'tool_exec_1',
        toolName: 'exec',
        timestamp: '2026-03-10T10:05:10.000Z',
        content: [{ type: 'text', text: 'done' }],
      }),
      join(sessionsDir, 'sess_openclaw_1.jsonl'),
      {},
      sessionIndex,
      1
    );

    expect(event.role).toBe('assistant');
    expect(event.toolCalls).toHaveLength(1);
    expect(event.toolCalls[0].type).toBe('tool_result');
    expect(event.toolCalls[0].name).toBe('exec');
  });

  it('should discover session stores and parse all events', async () => {
    const stores = await findSessionStores(root);
    expect(stores).toHaveLength(1);

    const events = await parseAllEvents(root);
    expect(events).toHaveLength(4);
    expect(new Set(events.map((event) => event.id)).size).toBe(4);
  });
});
