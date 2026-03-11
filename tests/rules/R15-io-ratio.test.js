import { describe, it, expect } from 'vitest';
import R15 from '../../src/rules/rules/R15-io-ratio.js';

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

describe('R15 IO Ratio', () => {
  it('should have correct id and severity', () => {
    expect(R15.id).toBe('R15_io_ratio');
    expect(R15.severity).toBe('MEDIUM');
  });

  it('should not trigger with balanced ratio', () => {
    const events = [
      createMockEvent({ inputTokens: 4000, outputTokens: 1000 }),  // ratio 4:1
      createMockEvent({ inputTokens: 6000, outputTokens: 1000 }),  // ratio 6:1
    ];
    // overall ratio = 10000 / 2000 = 5, which is <= 20

    const result = R15.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should trigger with ratio > 20', () => {
    const events = [
      createMockEvent({ inputTokens: 50000, outputTokens: 100 }),  // ratio 500:1
      createMockEvent({ inputTokens: 30000, outputTokens: 200 }),  // ratio 150:1
    ];
    // overall ratio = 80000 / 300 ≈ 266.7 > 20

    const result = R15.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.triggered).toBe(true);
    expect(result.ruleId).toBe('R15_io_ratio');
  });

  it('should include ratio detail', () => {
    const events = [
      createMockEvent({ inputTokens: 50000, outputTokens: 100 }),
    ];

    const result = R15.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.detail).toHaveProperty('overallRatio');
    expect(result.detail.overallRatio).toBeGreaterThan(20);
    expect(result.detail).toHaveProperty('totalInput');
    expect(result.detail).toHaveProperty('totalOutput');
    expect(result.detail).toHaveProperty('healthyRange');
  });

  it('should return null when no events have both input and output tokens', () => {
    const events = [
      createMockEvent({ inputTokens: 1000, outputTokens: 0 }),
    ];

    const result = R15.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should calculate estimated wasted tokens', () => {
    const events = [
      createMockEvent({ inputTokens: 50000, outputTokens: 100 }),
    ];

    const result = R15.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    // wasted = totalInput - totalOutput * 8 = 50000 - 100 * 8 = 49200
    expect(result.estimatedWastedTokens).toBe(49200);
  });

  it('should not trigger at exactly ratio 20', () => {
    const events = [
      createMockEvent({ inputTokens: 20000, outputTokens: 1000 }),
    ];
    // ratio = 20000 / 1000 = 20 (not > 20)

    const result = R15.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });
});
