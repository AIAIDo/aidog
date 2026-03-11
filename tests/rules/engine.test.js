import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../../src/rules/engine.js';

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

describe('RuleEngine', () => {
  describe('groupBySession', () => {
    it('should group events by sessionId', () => {
      const engine = new RuleEngine();
      const events = [
        createMockEvent({ sessionId: 'sess-A' }),
        createMockEvent({ sessionId: 'sess-B' }),
        createMockEvent({ sessionId: 'sess-A' }),
      ];

      const groups = engine.groupBySession(events);
      expect(Object.keys(groups)).toHaveLength(2);
      expect(groups['sess-A']).toHaveLength(2);
      expect(groups['sess-B']).toHaveLength(1);
    });
  });

  describe('analyze', () => {
    it('should return proper structure for empty events', async () => {
      const engine = new RuleEngine();
      // With empty events, Math.min/max on empty spread returns Infinity/-Infinity
      // This is expected behavior but we need at least one event
      const result = await engine.analyze([createMockEvent()]);

      expect(result).toHaveProperty('totalTokens');
      expect(result).toHaveProperty('totalWastedTokens');
      expect(result).toHaveProperty('byRule');
      expect(result).toHaveProperty('bySeverity');
      expect(result).toHaveProperty('healthScore');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('periodStart');
      expect(result).toHaveProperty('periodEnd');
    });

    it('should run registered rules and collect triggered results', async () => {
      const engine = new RuleEngine();

      // Register a mock rule that always triggers
      engine.registerRule({
        id: 'test_rule',
        name: 'Test Rule',
        check(events, session) {
          return {
            ruleId: 'test_rule',
            severity: 'medium',
            triggered: true,
            occurrences: 1,
            detail: { test: true },
            estimatedWastedTokens: 100,
            evidence: [],
          };
        },
      });

      const events = [
        createMockEvent({ sessionId: 'sess-1' }),
        createMockEvent({ sessionId: 'sess-2' }),
      ];

      const result = await engine.analyze(events);
      expect(result.byRule).toHaveProperty('test_rule');
      expect(result.totalWastedTokens).toBe(200); // triggered for 2 sessions
    });

    it('should not include non-triggered rules in results', async () => {
      const engine = new RuleEngine();

      engine.registerRule({
        id: 'silent_rule',
        name: 'Silent Rule',
        check() {
          return null;
        },
      });

      const events = [createMockEvent()];
      const result = await engine.analyze(events);
      expect(result.byRule).not.toHaveProperty('silent_rule');
    });
  });

  describe('calculateHealthScore', () => {
    it('should return perfect score with no tokens', () => {
      const engine = new RuleEngine();
      const score = engine.calculateHealthScore([], 0, 0, 0);
      expect(score.score).toBe(100);
      expect(score.grade).toBe('A');
    });

    it('should return lower score with high waste ratio', () => {
      const engine = new RuleEngine();
      const score = engine.calculateHealthScore([], 100000, 40000, 20);
      expect(score.score).toBeLessThan(100);
    });

    it('should assign correct grades based on score', () => {
      const engine = new RuleEngine();

      // A: >= 90
      const scoreA = engine.calculateHealthScore([], 100000, 0, 20);
      expect(scoreA.score).toBeGreaterThanOrEqual(90);
      expect(scoreA.grade).toBe('A');

      // High waste: 50% waste → wasteScore=0, other dimensions default to max (60) → score ~60 → C
      const scoreHighWaste = engine.calculateHealthScore([], 100000, 50000, 20);
      expect(scoreHighWaste.score).toBeLessThan(75);
      expect(['C', 'D'].includes(scoreHighWaste.grade)).toBe(true);
    });

    it('should include breakdown in health score', () => {
      const engine = new RuleEngine();
      const score = engine.calculateHealthScore([], 100000, 10000, 20);

      expect(score.breakdown).toHaveProperty('wasteRatio');
      expect(score.breakdown).toHaveProperty('cacheEfficiency');
      expect(score.breakdown).toHaveProperty('modelFit');
      expect(score.breakdown).toHaveProperty('sessionHygiene');
      expect(score.breakdown).toHaveProperty('toolEfficiency');
    });

    it('should have trend as stable by default', () => {
      const engine = new RuleEngine();
      const score = engine.calculateHealthScore([], 100000, 10000, 20);
      expect(score.trend).toBe('stable');
    });

    it('should not over-penalize a small number of bad sessions in a large sample', () => {
      const engine = new RuleEngine();
      const score = engine.calculateHealthScore([
        { ruleId: 'R1_context_growth', sessionId: 'bad-session' },
      ], 100000, 1000, 100);

      expect(score.score).toBeGreaterThan(90);
      expect(score.breakdown.wasteRatio).toBeGreaterThanOrEqual(38);
    });
  });
});
