import { describe, it, expect, beforeEach } from 'vitest';
import { GeminiPlugin } from '../../src/plugins/gemini/index.js';
import { parseSessionFile } from '../../src/plugins/gemini/parser.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('GeminiPlugin', () => {
  let plugin;

  beforeEach(() => {
    plugin = new GeminiPlugin();
  });

  it('should expose valid plugin metadata', () => {
    expect(plugin.meta.name).toBe('gemini');
    expect(plugin.meta.displayName).toBe('Gemini CLI');
    expect(plugin.meta.version).toBe('0.1.0');
  });

  it('should return a boolean from isAvailable()', async () => {
    const available = await plugin.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});

describe('gemini parser', () => {
  it('should parse gemini messages with tokens into token events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aidog-gemini-test-'));
    const chatsDir = join(dir, 'chats');
    mkdirSync(chatsDir, { recursive: true });
    const file = join(chatsDir, 'session-2026-03-01T10-00-abcd1234.json');

    const session = {
      sessionId: 'abcd1234-5678-90ab-cdef-111111111111',
      projectHash: 'abc123hash',
      startTime: '2026-03-01T10:00:00.000Z',
      lastUpdated: '2026-03-01T10:05:00.000Z',
      messages: [
        {
          id: 'msg-user-1',
          timestamp: '2026-03-01T10:00:00.000Z',
          type: 'user',
          content: [{ text: 'hello' }],
        },
        {
          id: 'msg-gemini-1',
          timestamp: '2026-03-01T10:00:05.000Z',
          type: 'gemini',
          content: 'Hello! How can I help you?',
          tokens: {
            input: 100,
            output: 20,
            cached: 10,
            thoughts: 30,
            tool: 0,
            total: 160,
          },
          model: 'gemini-3-flash-preview',
        },
        {
          id: 'msg-gemini-2',
          timestamp: '2026-03-01T10:01:00.000Z',
          type: 'gemini',
          content: 'Here is the result.',
          tokens: {
            input: 200,
            output: 50,
            cached: 80,
            thoughts: 10,
            tool: 15,
            total: 355,
          },
          model: 'gemini-3-flash-preview',
          toolCalls: [
            {
              id: 'read_file_1',
              name: 'read_file',
              args: { file_path: 'src/index.js' },
              result: [{ functionResponse: { content: 'file content here' } }],
              status: 'success',
              timestamp: '2026-03-01T10:00:55.000Z',
            },
          ],
        },
      ],
    };

    writeFileSync(file, JSON.stringify(session));

    const events = await parseSessionFile(file, 'test-project');

    expect(events).toHaveLength(3);

    // User message
    expect(events[0].agent).toBe('gemini');
    expect(events[0].role).toBe('user');
    expect(events[0].usage.input_tokens).toBe(0);

    // First gemini message
    expect(events[1].agent).toBe('gemini');
    expect(events[1].sessionId).toBe('abcd1234-5678-90ab-cdef-111111111111');
    expect(events[1].projectName).toBe('test-project');
    expect(events[1].role).toBe('assistant');
    expect(events[1].model).toBe('gemini-3-flash-preview');
    expect(events[1].usage.input_tokens).toBe(130); // 100 + 30 thoughts
    expect(events[1].usage.output_tokens).toBe(20);
    expect(events[1].usage.cache_read_input_tokens).toBe(10);
    expect(events[1].toolCalls).toBeUndefined();

    // Second gemini message with tool calls
    expect(events[2].usage.input_tokens).toBe(210); // 200 + 10 thoughts
    expect(events[2].usage.output_tokens).toBe(50);
    expect(events[2].usage.cache_read_input_tokens).toBe(80);
    expect(events[2].toolCalls).toHaveLength(1);
    expect(events[2].toolCalls[0].name).toBe('read_file');
    expect(events[2].toolCalls[0].type).toBe('tool_use');
    expect(events[2].toolCalls[0].inputSize).toBeGreaterThan(0);
    expect(events[2].toolCalls[0].outputSize).toBeGreaterThan(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it('should include user messages and skip messages without tokens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aidog-gemini-test-'));
    const chatsDir = join(dir, 'chats');
    mkdirSync(chatsDir, { recursive: true });
    const file = join(chatsDir, 'session-2026-03-01T10-00-skip1234.json');

    const session = {
      sessionId: 'skip1234-5678-90ab-cdef-222222222222',
      messages: [
        {
          id: 'msg-user-1',
          timestamp: '2026-03-01T10:00:00.000Z',
          type: 'user',
          content: [{ text: 'hello' }],
        },
        {
          id: 'msg-gemini-no-tokens',
          timestamp: '2026-03-01T10:00:05.000Z',
          type: 'gemini',
          content: 'Some response without token data',
        },
      ],
    };

    writeFileSync(file, JSON.stringify(session));
    const events = await parseSessionFile(file, 'proj');

    // User message is now included, gemini message without tokens is skipped
    expect(events).toHaveLength(1);
    expect(events[0].role).toBe('user');

    rmSync(dir, { recursive: true, force: true });
  });

  it('should return empty array for invalid file', async () => {
    const events = await parseSessionFile('/nonexistent/path/session.json');
    expect(events).toEqual([]);
  });

  it('should generate unique event IDs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aidog-gemini-test-'));
    const chatsDir = join(dir, 'chats');
    mkdirSync(chatsDir, { recursive: true });
    const file = join(chatsDir, 'session-2026-03-01T10-00-uniq1234.json');

    const session = {
      sessionId: 'uniq1234-0000-0000-0000-000000000000',
      messages: [
        {
          id: 'msg-1',
          timestamp: '2026-03-01T10:00:00.000Z',
          type: 'gemini',
          content: 'Response 1',
          tokens: { input: 10, output: 5, cached: 0, thoughts: 0, tool: 0, total: 15 },
          model: 'gemini-3-flash',
        },
        {
          id: 'msg-2',
          timestamp: '2026-03-01T10:01:00.000Z',
          type: 'gemini',
          content: 'Response 2',
          tokens: { input: 20, output: 10, cached: 0, thoughts: 0, tool: 0, total: 30 },
          model: 'gemini-3-flash',
        },
      ],
    };

    writeFileSync(file, JSON.stringify(session));
    const events = await parseSessionFile(file);

    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    rmSync(dir, { recursive: true, force: true });
  });
});
