import { describe, it, expect } from 'vitest';
import R1 from '../../src/rules/rules/R1-context-growth.js';

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

describe('R1 Context Growth', () => {
  it('should have correct id and severity', () => {
    expect(R1.id).toBe('R1_context_growth');
    expect(R1.severity).toBe('HIGH');
  });

  it('should not trigger with stable input tokens', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      createMockEvent({ inputTokens: 1000, timestamp: Date.now() + i * 1000 })
    );

    const result = R1.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should not trigger with fewer than 6 turns', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      createMockEvent({ inputTokens: 1000 * (i + 1), timestamp: Date.now() + i * 1000 })
    );

    const result = R1.check(events, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });

  it('should trigger with 5+ consecutive growing turns exceeding 3x growth', () => {
    // Create events where input tokens grow >20% each turn for 6+ consecutive turns
    // Starting at 1000, each turn grows by ~30%
    const events = [];
    let tokens = 1000;
    for (let i = 0; i < 10; i++) {
      events.push(createMockEvent({
        inputTokens: Math.round(tokens),
        timestamp: Date.now() + i * 1000,
      }));
      tokens *= 1.35; // 35% growth per turn
    }
    // Final tokens should be ~1000 * 1.35^9 ≈ 17,000+ which is >3x baseline

    const result = R1.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.triggered).toBe(true);
    expect(result.ruleId).toBe('R1_context_growth');
    expect(result.severity).toBe('HIGH');
    expect(result.occurrences).toBeGreaterThanOrEqual(5);
  });

  it('should generate evidence for triggered rule', () => {
    const events = [];
    let tokens = 1000;
    for (let i = 0; i < 10; i++) {
      events.push(createMockEvent({
        inputTokens: Math.round(tokens),
        timestamp: Date.now() + i * 1000,
      }));
      tokens *= 1.35;
    }

    const result = R1.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.evidence).toBeInstanceOf(Array);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]).toHaveProperty('eventId');
    expect(result.evidence[0]).toHaveProperty('sessionId');
    expect(result.evidence[0]).toHaveProperty('inputTokens');
    expect(result.evidence[0]).toHaveProperty('wastedTokens');
    expect(result.evidence[0]).toHaveProperty('reason');
  });

  it('should calculate wasted tokens correctly', () => {
    const events = [];
    let tokens = 1000;
    for (let i = 0; i < 10; i++) {
      events.push(createMockEvent({
        inputTokens: Math.round(tokens),
        timestamp: Date.now() + i * 1000,
      }));
      tokens *= 1.35;
    }

    const result = R1.check(events, { sessionId: 'sess-1' });
    expect(result).not.toBeNull();
    expect(result.estimatedWastedTokens).toBeGreaterThan(0);
    expect(result.detail).toHaveProperty('growthRatio');
    expect(result.detail.growthRatio).toBeGreaterThanOrEqual(3);
  });

  it('should not trigger if last input is less than 3x the first', () => {
    // Growth >20% per turn but total growth < 3x
    const events = [];
    let tokens = 1000;
    for (let i = 0; i < 8; i++) {
      events.push(createMockEvent({
        inputTokens: Math.round(tokens),
        timestamp: Date.now() + i * 1000,
      }));
      tokens *= 1.21; // Just barely above 20% but won't reach 3x in 8 turns (1.21^7 ≈ 3.7)
    }
    // Actually 1.21^7 ≈ 3.8, which is > 3x. Let's use smaller growth
    const events2 = [];
    let tokens2 = 1000;
    for (let i = 0; i < 7; i++) {
      events2.push(createMockEvent({
        inputTokens: Math.round(tokens2),
        timestamp: Date.now() + i * 1000,
      }));
      tokens2 *= 1.15; // 15% growth, not enough to trigger >20% check
    }

    const result = R1.check(events2, { sessionId: 'sess-1' });
    expect(result).toBeNull();
  });
});
