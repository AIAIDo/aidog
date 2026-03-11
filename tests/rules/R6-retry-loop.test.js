import { describe, it, expect } from 'vitest';
import R6 from '../../src/rules/rules/R6-retry-loop.js';

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

describe('R6 Retry Loop', () => {
  it('should have correct id and severity', () => {
    expect(R6.id).toBe('R6_retry_loop');
    expect(R6.severity).toBe('HIGH');
  });

  it('should not trigger with stable input tokens', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      createMockEvent({ inputTokens: 1000, timestamp: Date.now() + i * 1000 })
    );

    const result = R6.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should not trigger with fewer than 4 turns', () => {
    const events = [
      createMockEvent({ inputTokens: 1000 }),
      createMockEvent({ inputTokens: 1200 }),
      createMockEvent({ inputTokens: 1500 }),
    ];

    const result = R6.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should trigger with 3+ consecutive increases >10%', () => {
    const events = [
      createMockEvent({ inputTokens: 1000, timestamp: Date.now() }),
      createMockEvent({ inputTokens: 1200, timestamp: Date.now() + 1000 }),  // +20%
      createMockEvent({ inputTokens: 1500, timestamp: Date.now() + 2000 }),  // +25%
      createMockEvent({ inputTokens: 1800, timestamp: Date.now() + 3000 }),  // +20%
      createMockEvent({ inputTokens: 2200, timestamp: Date.now() + 4000 }),  // +22%
    ];

    const result = R6.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.triggered).toBe(true);
    expect(result.ruleId).toBe('R6_retry_loop');
    expect(result.detail.consecutiveIncreases).toBeGreaterThanOrEqual(3);
  });

  it('should calculate estimated wasted tokens', () => {
    const events = [
      createMockEvent({ inputTokens: 1000, timestamp: Date.now() }),
      createMockEvent({ inputTokens: 1200, timestamp: Date.now() + 1000 }),
      createMockEvent({ inputTokens: 1500, timestamp: Date.now() + 2000 }),
      createMockEvent({ inputTokens: 1800, timestamp: Date.now() + 3000 }),
      createMockEvent({ inputTokens: 2200, timestamp: Date.now() + 4000 }),
    ];

    const result = R6.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.estimatedWastedTokens).toBeGreaterThan(0);
  });

  it('should not trigger when increases are < 10%', () => {
    const events = [
      createMockEvent({ inputTokens: 1000, timestamp: Date.now() }),
      createMockEvent({ inputTokens: 1050, timestamp: Date.now() + 1000 }),  // +5%
      createMockEvent({ inputTokens: 1090, timestamp: Date.now() + 2000 }),  // +3.8%
      createMockEvent({ inputTokens: 1120, timestamp: Date.now() + 3000 }),  // +2.7%
      createMockEvent({ inputTokens: 1150, timestamp: Date.now() + 4000 }),  // +2.7%
    ];

    const result = R6.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should include evidence for triggered turns', () => {
    const events = [
      createMockEvent({ inputTokens: 1000, timestamp: Date.now() }),
      createMockEvent({ inputTokens: 1200, timestamp: Date.now() + 1000 }),
      createMockEvent({ inputTokens: 1500, timestamp: Date.now() + 2000 }),
      createMockEvent({ inputTokens: 1800, timestamp: Date.now() + 3000 }),
      createMockEvent({ inputTokens: 2200, timestamp: Date.now() + 4000 }),
    ];

    const result = R6.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.evidence).toBeInstanceOf(Array);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]).toHaveProperty('inputTokens');
    expect(result.evidence[0]).toHaveProperty('reason');
  });
});
