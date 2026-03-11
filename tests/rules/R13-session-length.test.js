import { describe, it, expect } from 'vitest';
import R13 from '../../src/rules/rules/R13-session-length.js';

function createMockEvent(overrides = {}) {
  return {
    id: `claude-code:msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'test-session-1',
    timestamp: Date.now(),
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    toolCalls: [],
    ...overrides,
  };
}

describe('R13 Session Length', () => {
  it('should have correct id and severity', () => {
    expect(R13.id).toBe('R13_session_length');
    expect(R13.severity).toBe('HIGH');
  });

  it('should not trigger with short session (<= 15 turns)', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      createMockEvent({ inputTokens: 1000, timestamp: Date.now() + i * 1000 })
    );

    const result = R13.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should not trigger with exactly 15 turns', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      createMockEvent({ inputTokens: 1000, timestamp: Date.now() + i * 1000 })
    );

    const result = R13.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should trigger with long session where later turns have much higher input', () => {
    const events = [];

    // First 10 turns at ~1000 input tokens
    for (let i = 0; i < 10; i++) {
      events.push(createMockEvent({
        inputTokens: 1000,
        timestamp: Date.now() + i * 1000,
      }));
    }

    // Last 10 turns at ~5000 input tokens (5x the baseline)
    for (let i = 10; i < 20; i++) {
      events.push(createMockEvent({
        inputTokens: 5000,
        timestamp: Date.now() + i * 1000,
      }));
    }

    const result = R13.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.triggered).toBe(true);
    expect(result.ruleId).toBe('R13_session_length');
    expect(result.detail.totalTurns).toBe(20);
    expect(result.detail.avgLast5Input).toBeGreaterThan(result.detail.avgFirst5Input * 2);
  });

  it('should not trigger with long session but stable input', () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      createMockEvent({
        inputTokens: 1000,
        timestamp: Date.now() + i * 1000,
      })
    );

    const result = R13.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should calculate wasted tokens from turns after 15', () => {
    const events = [];

    // First 10 turns at 1000 tokens
    for (let i = 0; i < 10; i++) {
      events.push(createMockEvent({
        inputTokens: 1000,
        timestamp: Date.now() + i * 1000,
      }));
    }

    // Turns 10-19 at 6000 tokens (6x baseline, last5 avg is 6000 > first5 avg 1000 * 2)
    for (let i = 10; i < 20; i++) {
      events.push(createMockEvent({
        inputTokens: 6000,
        timestamp: Date.now() + i * 1000,
      }));
    }

    const result = R13.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.estimatedWastedTokens).toBeGreaterThan(0);

    // Waste comes from turns after index 15 (turns 16-19)
    // baseline = avgFirst5 = 1000
    // 5 turns after 15, each excess = 6000 - 1000 = 5000
    // total wasted ≈ 5 * 5000 = 25000
    expect(result.estimatedWastedTokens).toBe(25000);
  });

  it('should include evidence from turns after turn 15', () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push(createMockEvent({
        inputTokens: 1000,
        timestamp: Date.now() + i * 1000,
      }));
    }
    for (let i = 10; i < 20; i++) {
      events.push(createMockEvent({
        inputTokens: 5000,
        timestamp: Date.now() + i * 1000,
      }));
    }

    const result = R13.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.evidence).toBeInstanceOf(Array);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]).toHaveProperty('reason');
    expect(result.evidence[0].reason).toContain('Turn');
  });
});
