import { describe, it, expect } from 'vitest';
import R12 from '../../src/rules/rules/R12-model-mismatch.js';

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

describe('R12 Model Mismatch', () => {
  it('should have correct id and severity', () => {
    expect(R12.id).toBe('R12_model_mismatch');
    expect(R12.severity).toBe('MEDIUM');
  });

  it('should not trigger with sonnet model', () => {
    const events = [
      createMockEvent({ model: 'claude-sonnet-4-20250514', inputTokens: 500, outputTokens: 100 }),
      createMockEvent({ model: 'claude-sonnet-4-20250514', inputTokens: 800, outputTokens: 200 }),
    ];

    const result = R12.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should trigger with opus model and small token usage', () => {
    const events = [
      createMockEvent({ model: 'claude-3-opus', inputTokens: 500, outputTokens: 100 }),
      createMockEvent({ model: 'claude-3-opus', inputTokens: 800, outputTokens: 200 }),
    ];

    const result = R12.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.triggered).toBe(true);
    expect(result.ruleId).toBe('R12_model_mismatch');
    expect(result.detail.mismatchCount).toBe(2);
    expect(result.detail.modelsUsed).toContain('claude-3-opus');
  });

  it('should not trigger with opus model and large token usage', () => {
    const events = [
      createMockEvent({ model: 'claude-3-opus', inputTokens: 5000, outputTokens: 2000 }),
      createMockEvent({ model: 'claude-3-opus', inputTokens: 8000, outputTokens: 3000 }),
    ];

    const result = R12.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should also detect gpt-4 as a large model', () => {
    const events = [
      createMockEvent({ model: 'gpt-4', inputTokens: 500, outputTokens: 100 }),
    ];

    const result = R12.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.triggered).toBe(true);
  });

  it('should calculate estimated wasted tokens as 30% of total', () => {
    const events = [
      createMockEvent({ model: 'claude-3-opus', inputTokens: 1000, outputTokens: 200 }),
    ];

    const result = R12.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    // totalTokens = 1000 + 200 = 1200; wasted = 1200 * 0.3 = 360
    expect(result.estimatedWastedTokens).toBe(360);
  });

  it('should include evidence with per-event detail', () => {
    const events = [
      createMockEvent({ model: 'claude-3-opus', inputTokens: 500, outputTokens: 100 }),
    ];

    const result = R12.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toHaveProperty('reason');
    expect(result.evidence[0].reason).toContain('claude-3-opus');
    expect(result.evidence[0].reason).toContain('cheaper model');
  });
});
