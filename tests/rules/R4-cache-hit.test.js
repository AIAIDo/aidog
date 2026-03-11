import { describe, it, expect } from 'vitest';
import R4 from '../../src/rules/rules/R4-cache-hit.js';

function createMockEvent(overrides = {}) {
  return {
    id: `claude-code:msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'test-session-1',
    timestamp: Date.now(),
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: [],
    ...overrides,
  };
}

describe('R4 Cache Hit', () => {
  it('should have correct id and severity', () => {
    expect(R4.id).toBe('R4_cache_hit');
    expect(R4.severity).toBe('MEDIUM');
  });

  it('should not trigger when cache hit rate >= 0.3', () => {
    const events = [
      createMockEvent({ inputTokens: 1000, cacheReadTokens: 600 }),
      createMockEvent({ inputTokens: 1000, cacheReadTokens: 500 }),
    ];
    // total input = 2000, total cache = 1100
    // rate = 1100 / (2000 + 1100) = 0.354 > 0.3

    const result = R4.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should trigger when cache hit rate < 0.3', () => {
    const events = [
      createMockEvent({ inputTokens: 5000, cacheReadTokens: 100 }),
      createMockEvent({ inputTokens: 5000, cacheReadTokens: 100 }),
    ];
    // total input = 10000, total cache = 200
    // rate = 200 / (10000 + 200) = 0.0196 < 0.3

    const result = R4.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.triggered).toBe(true);
    expect(result.ruleId).toBe('R4_cache_hit');
  });

  it('should include cacheHitRate in detail', () => {
    const events = [
      createMockEvent({ inputTokens: 10000, cacheReadTokens: 50 }),
    ];
    // rate = 50 / (10000 + 50) ≈ 0.005

    const result = R4.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.detail).toHaveProperty('cacheHitRate');
    expect(result.detail.cacheHitRate).toBeLessThan(0.3);
    expect(result.detail).toHaveProperty('totalInputTokens');
    expect(result.detail).toHaveProperty('totalCacheReadTokens');
  });

  it('should return null when no events have input tokens', () => {
    const events = [
      createMockEvent({ inputTokens: 0 }),
    ];

    const result = R4.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should calculate estimated wasted tokens', () => {
    const events = [
      createMockEvent({ inputTokens: 10000, cacheReadTokens: 0 }),
    ];

    const result = R4.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.estimatedWastedTokens).toBe(3000); // 30% of 10000
  });
});
