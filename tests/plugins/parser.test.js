import { describe, it, expect, afterEach } from 'vitest';
import { parseLine, extractToolCalls, decodeProjectPath, parseJSONLFile } from '../../src/plugins/claude-code/parser.js';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseLine', () => {
  const filePath = '/home/user/.claude/projects/%2Fhome%2Fuser%2Fmyproject/session.jsonl';

  it('should parse a valid assistant message with usage', () => {
    const line = JSON.stringify({
      timestamp: '2025-01-15T10:00:00Z',
      sessionId: 'sess-1',
      message: {
        id: 'msg_abc123',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'Hello!' }],
        usage: {
          input_tokens: 5000,
          output_tokens: 1000,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 3000,
        },
      },
    });

    const event = parseLine(line, filePath);
    expect(event).not.toBeNull();
    expect(event.id).toBe('claude-code:msg_abc123');
    expect(event.agent).toBe('claude-code');
    expect(event.sessionId).toBe('sess-1');
    expect(event.role).toBe('assistant');
    expect(event.model).toBe('claude-sonnet-4-20250514');
    expect(event.usage.input_tokens).toBe(5000);
    expect(event.usage.output_tokens).toBe(1000);
    expect(event.usage.cache_creation_input_tokens).toBe(200);
    expect(event.usage.cache_read_input_tokens).toBe(3000);
  });

  it('should parse a user message (no usage)', () => {
    const line = JSON.stringify({
      timestamp: '2025-01-15T10:00:00Z',
      sessionId: 'sess-1',
      message: {
        id: 'msg_user1',
        role: 'user',
        content: [{ type: 'text', text: 'Fix the bug' }],
      },
    });

    const event = parseLine(line, filePath);
    expect(event).not.toBeNull();
    expect(event.role).toBe('user');
    expect(event.usage.input_tokens).toBe(0);
    expect(event.usage.output_tokens).toBe(0);
  });

  it('should skip summary type lines', () => {
    const line = JSON.stringify({
      type: 'summary',
      data: { totalTokens: 10000 },
    });

    const event = parseLine(line, filePath);
    expect(event).toBeNull();
  });

  it('should skip lines without message field', () => {
    const line = JSON.stringify({
      timestamp: '2025-01-15T10:00:00Z',
      someOtherField: 'value',
    });

    const event = parseLine(line, filePath);
    expect(event).toBeNull();
  });

  it('should return null for empty lines', () => {
    expect(parseLine('', filePath)).toBeNull();
    expect(parseLine('   ', filePath)).toBeNull();
  });

  it('should return null for malformed JSON lines', () => {
    expect(parseLine('{invalid json', filePath)).toBeNull();
  });
});

describe('extractToolCalls', () => {
  it('should extract tool_use blocks', () => {
    const content = [
      { type: 'text', text: 'Let me read the file.' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/src/index.js' } },
    ];

    const toolCalls = extractToolCalls(content);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].type).toBe('tool_use');
    expect(toolCalls[0].name).toBe('Read');
    expect(toolCalls[0].inputSize).toBeGreaterThan(0);
  });

  it('should extract tool_result blocks', () => {
    const content = [
      { type: 'tool_result', content: 'file contents here' },
    ];

    const toolCalls = extractToolCalls(content);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].type).toBe('tool_result');
    expect(toolCalls[0].name).toBe('unknown');
    expect(toolCalls[0].outputSize).toBeGreaterThan(0);
  });

  it('should return empty array for non-array input', () => {
    expect(extractToolCalls(null)).toEqual([]);
    expect(extractToolCalls(undefined)).toEqual([]);
    expect(extractToolCalls('string')).toEqual([]);
  });

  it('should filter out non-tool blocks', () => {
    const content = [
      { type: 'text', text: 'Just text' },
      { type: 'image', data: 'base64...' },
    ];

    const toolCalls = extractToolCalls(content);
    expect(toolCalls).toEqual([]);
  });
});

describe('decodeProjectPath', () => {
  it('should decode URL-encoded paths', () => {
    const encoded = '%2Fhome%2Fuser%2Fmy%20project';
    expect(decodeProjectPath(encoded)).toBe('/home/user/my project');
  });

  it('should return original string for non-encoded paths', () => {
    expect(decodeProjectPath('/simple/path')).toBe('/simple/path');
  });

  it('should handle malformed encoding gracefully', () => {
    // decodeURIComponent throws on invalid sequences like %ZZ
    const result = decodeProjectPath('%ZZinvalid');
    expect(typeof result).toBe('string');
  });
});

describe('parseJSONLFile', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should parse a multi-line JSONL file', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidog-parser-test-'));
    const filePath = join(tmpDir, 'test.jsonl');

    const lines = [
      JSON.stringify({
        timestamp: '2025-01-15T10:00:00Z',
        sessionId: 'sess-1',
        message: {
          id: 'msg_1',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Response 1' }],
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
      }),
      JSON.stringify({
        timestamp: '2025-01-15T10:01:00Z',
        sessionId: 'sess-1',
        message: {
          id: 'msg_2',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Response 2' }],
          usage: { input_tokens: 2000, output_tokens: 800 },
        },
      }),
    ];

    writeFileSync(filePath, lines.join('\n'));

    const events = await parseJSONLFile(filePath);
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('claude-code:msg_1');
    expect(events[1].id).toBe('claude-code:msg_2');
  });

  it('should return empty array for nonexistent file', async () => {
    const events = await parseJSONLFile('/nonexistent/path/file.jsonl');
    expect(events).toEqual([]);
  });

  it('should skip malformed JSON lines in file', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidog-parser-test-'));
    const filePath = join(tmpDir, 'malformed.jsonl');

    const content = [
      JSON.stringify({
        sessionId: 'sess-1',
        message: { id: 'msg_ok', role: 'assistant', content: [], usage: { input_tokens: 100, output_tokens: 50 } },
      }),
      '{broken json',
      '',
      JSON.stringify({
        sessionId: 'sess-1',
        message: { id: 'msg_ok2', role: 'assistant', content: [], usage: { input_tokens: 200, output_tokens: 100 } },
      }),
    ].join('\n');

    writeFileSync(filePath, content);

    const events = await parseJSONLFile(filePath);
    expect(events).toHaveLength(2);
  });
});
