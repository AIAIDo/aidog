import { describe, it, expect } from 'vitest';
import R2 from '../../src/rules/rules/R2-tool-loop.js';

function createToolEvent(toolName, timestamp, overrides = {}) {
  return {
    id: `claude-code:msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'test-session-1',
    timestamp,
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    toolName,
    toolCalls: [],
    ...overrides,
  };
}

describe('R2 Tool Loop', () => {
  it('should have correct id and severity', () => {
    expect(R2.id).toBe('R2_tool_loop');
    expect(R2.severity).toBe('HIGH');
  });

  it('should not trigger with no tool events', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      id: `msg_${i}`,
      sessionId: 'sess-1',
      timestamp: Date.now() + i * 1000,
      inputTokens: 1000,
      outputTokens: 500,
    }));

    const result = R2.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should not trigger with fewer than 6 calls of the same tool', () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) =>
      createToolEvent('Read', now + i * 60000)
    );

    const result = R2.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should trigger with >5 same tool calls within 30 min', () => {
    const now = Date.now();
    // 8 calls of the same tool within short intervals (1 min apart)
    const events = Array.from({ length: 8 }, (_, i) =>
      createToolEvent('Read', now + i * 60000) // 1 min apart
    );

    const result = R2.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.triggered).toBe(true);
    expect(result.ruleId).toBe('R2_tool_loop');
    expect(result.detail.loops).toBeInstanceOf(Array);
    expect(result.detail.loops[0].toolName).toBe('Read');
    expect(result.detail.loops[0].count).toBeGreaterThan(5);
  });

  it('should not trigger when different tools are used', () => {
    const now = Date.now();
    const toolNames = ['Read', 'Write', 'Bash', 'Grep', 'Glob', 'Edit'];
    const events = toolNames.map((name, i) =>
      createToolEvent(name, now + i * 60000)
    );

    const result = R2.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should not trigger when same tool calls are spread over long time', () => {
    const now = Date.now();
    // 8 calls of the same tool but 10 minutes apart each (total 70 min, > 30 min window)
    const events = Array.from({ length: 8 }, (_, i) =>
      createToolEvent('Read', now + i * 10 * 60000) // 10 min apart
    );

    const result = R2.check(events, { sessionId: 'sess-1' });
    // May or may not trigger depending on sliding window — the rule checks each starting point
    // With 10 min intervals, in a 30 min window starting from event 0, we get events 0-3 (4 events, < 6)
    // So it should not trigger
    expect(result).toBeNull();
  });
});

describe('R2 with storage event shape (toolCalls array)', () => {
  it('triggers when toolCalls array has repeated tool', () => {
    const now = Date.now();
    const events = Array.from({ length: 8 }, (_, i) => ({
      id: `msg_${i}`, sessionId: 'sess-1',
      timestamp: now + i * 60000,
      inputTokens: 1000, outputTokens: 500,
      toolCalls: [{ name: 'Read', input: { file_path: '/foo.js' } }],
    }));
    const result = R2.check(events, { sessionId: 'sess-1' });
    expect(result?.triggered).toBe(true);
  });
});
