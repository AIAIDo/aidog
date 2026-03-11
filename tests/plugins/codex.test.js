import { describe, it, expect, beforeEach } from 'vitest';
import { CodexPlugin } from '../../src/plugins/codex/index.js';
import { parseLine, parseJSONLFile } from '../../src/plugins/codex/parser.js';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CodexPlugin', () => {
  let plugin;

  beforeEach(() => {
    plugin = new CodexPlugin();
  });

  it('should expose valid plugin metadata', () => {
    expect(plugin.meta.name).toBe('codex');
    expect(plugin.meta.displayName).toBe('Codex CLI');
    expect(plugin.meta.version).toBe('0.1.0');
  });

  it('should return a boolean from isAvailable()', async () => {
    const available = await plugin.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});

describe('codex parser', () => {
  it('should parse token_count into token event after session_meta context', () => {
    const filePath = '/tmp/rollout-2026-03-08T00-00-00-11111111-2222-3333-4444-555555555555.jsonl';
    const state = {};

    parseLine(
      JSON.stringify({
        timestamp: '2026-03-08T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: '11111111-2222-3333-4444-555555555555',
          cwd: process.cwd(),
        },
      }),
      filePath,
      state,
      1
    );

    const event = parseLine(
      JSON.stringify({
        timestamp: '2026-03-08T00:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 120,
              output_tokens: 34,
              cached_input_tokens: 50,
            },
          },
        },
      }),
      filePath,
      state,
      2
    );

    expect(event).toBeTruthy();
    expect(event.agent).toBe('codex');
    expect(event.sessionId).toBe('11111111-2222-3333-4444-555555555555');
    expect(event.usage.input_tokens).toBe(120);
    expect(event.usage.output_tokens).toBe(34);
    expect(event.usage.cache_read_input_tokens).toBe(50);
  });

  it('should parse a codex JSONL file into token events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aidog-codex-test-'));
    const file = join(dir, 'rollout-2026-03-08T00-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl');

    const lines = [
      JSON.stringify({
        timestamp: '2026-03-08T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          cwd: process.cwd(),
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-08T00:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 10 } },
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-08T00:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 80, output_tokens: 30, cached_input_tokens: 5 } },
        },
      }),
    ];

    writeFileSync(file, lines.join('\n'));

    const events = await parseJSONLFile(file);
    expect(events).toHaveLength(2);
    expect(events[0].sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(events[1].usage.output_tokens).toBe(30);

    rmSync(dir, { recursive: true, force: true });
  });

  it('should not duplicate assistant text when response_item and agent_message contain the same text', () => {
    const filePath = '/tmp/rollout-2026-03-08T00-00-00-11111111-2222-3333-4444-555555555555.jsonl';
    const state = {};
    const repeatedText = '我已经定位到核心路径，下一步会逐个读 claude-code-acpx、agent 主循环、前端/服务端的 chat 事件处理。';

    parseLine(
      JSON.stringify({
        timestamp: '2026-03-08T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: '11111111-2222-3333-4444-555555555555',
          cwd: process.cwd(),
        },
      }),
      filePath,
      state,
      1
    );

    parseLine(
      JSON.stringify({
        timestamp: '2026-03-08T00:00:00.500Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: repeatedText }],
        },
      }),
      filePath,
      state,
      2
    );

    parseLine(
      JSON.stringify({
        timestamp: '2026-03-08T00:00:00.700Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: repeatedText,
        },
      }),
      filePath,
      state,
      3
    );

    const event = parseLine(
      JSON.stringify({
        timestamp: '2026-03-08T00:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 120,
              output_tokens: 34,
              cached_input_tokens: 50,
            },
          },
        },
      }),
      filePath,
      state,
      4
    );

    expect(event.content).toEqual([{ type: 'text', text: repeatedText }]);
  });
});
