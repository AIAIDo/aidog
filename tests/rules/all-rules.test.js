import { describe, it, expect } from 'vitest';
import { createRuleEngine, allRules } from '../../src/rules/index.js';

function createMockEvent(overrides = {}) {
  return {
    id: `claude-code:msg_${Math.random().toString(36).slice(2)}`,
    agentName: 'claude-code',
    sourceMessageId: `msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'test-session-1',
    projectPath: '/test/project',
    projectName: 'test-project',
    timestamp: Date.now(),
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: [],
    contentLength: 100,
    ...overrides,
  };
}

describe('All Rules Integration', () => {
  it('should export 18 rules', () => {
    expect(allRules).toHaveLength(18);
  });

  it('should create engine with all rules registered', () => {
    const engine = createRuleEngine();
    expect(engine.rules).toHaveLength(18);
  });

  it('should have unique rule IDs', () => {
    const ids = allRules.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(18);
  });

  it('should analyze events with all rules and return proper structure', async () => {
    const engine = createRuleEngine();

    const now = Date.now();
    const events = [
      createMockEvent({ timestamp: now - 10000 }),
      createMockEvent({ timestamp: now - 9000 }),
      createMockEvent({ timestamp: now - 8000 }),
    ];

    const result = await engine.analyze(events);

    expect(result).toHaveProperty('totalTokens');
    expect(result).toHaveProperty('totalWastedTokens');
    expect(result).toHaveProperty('byRule');
    expect(result).toHaveProperty('bySeverity');
    expect(result).toHaveProperty('healthScore');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('periodStart');
    expect(result).toHaveProperty('periodEnd');

    expect(result.totalTokens).toBe(4500); // 3 events * (1000 + 500)
    expect(typeof result.healthScore.score).toBe('number');
    expect(result.healthScore.grade).toMatch(/^[ABCDF]$/);
  });

  it('should trigger multiple rules with crafted events', async () => {
    const engine = createRuleEngine();
    const now = Date.now();
    const events = [];

    // Create events that trigger R4 (low cache hit) and R15 (high IO ratio)
    // High input, low output, no cache
    for (let i = 0; i < 5; i++) {
      events.push(createMockEvent({
        inputTokens: 50000,
        outputTokens: 100,
        cacheReadTokens: 0,
        timestamp: now + i * 1000,
      }));
    }

    // Add events that trigger R6 (retry loop): consecutive input increases >10%
    let retryTokens = 2000;
    for (let i = 5; i < 10; i++) {
      events.push(createMockEvent({
        inputTokens: Math.round(retryTokens),
        outputTokens: 500,
        cacheReadTokens: 0,
        timestamp: now + i * 1000,
      }));
      retryTokens *= 1.2;
    }

    const result = await engine.analyze(events);

    // At minimum R4 (cache hit) and R15 (IO ratio) should trigger
    const triggeredRuleIds = Object.keys(result.byRule);
    expect(triggeredRuleIds.length).toBeGreaterThan(0);
    expect(result.totalWastedTokens).toBeGreaterThan(0);
  });
});
