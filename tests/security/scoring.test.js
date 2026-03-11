import { describe, it, expect } from 'vitest';
import { SecurityEngine } from '../../src/security/index.js';

describe('SecurityEngine scoring', () => {
  let engine;

  beforeEach(() => {
    engine = new SecurityEngine();
  });

  describe('applyTimeDecay', () => {
    it('should return full penalty at day 0', () => {
      expect(SecurityEngine.applyTimeDecay(20, 0)).toBe(20);
    });

    it('should return ~50% penalty at half-life (14 days)', () => {
      const result = SecurityEngine.applyTimeDecay(20, 14);
      expect(result).toBeCloseTo(10, 1);
    });

    it('should return ~25% penalty at 2x half-life (28 days)', () => {
      const result = SecurityEngine.applyTimeDecay(20, 28);
      expect(result).toBeCloseTo(5, 1);
    });

    it('should approach 0 for very old findings', () => {
      const result = SecurityEngine.applyTimeDecay(20, 100);
      expect(result).toBeLessThan(0.2);
    });

    it('should handle negative days as day 0', () => {
      expect(SecurityEngine.applyTimeDecay(10, -5)).toBe(10);
    });
  });

  describe('applySaturation', () => {
    it('should return 0 for 0 deduction', () => {
      expect(SecurityEngine.applySaturation(0)).toBe(0);
    });

    it('should be less than raw for small values', () => {
      const result = SecurityEngine.applySaturation(10, 50);
      expect(result).toBeLessThan(10);
      expect(result).toBeGreaterThan(0);
    });

    it('should approach max for large raw values', () => {
      const result = SecurityEngine.applySaturation(500, 50);
      expect(result).toBeGreaterThan(49);
      expect(result).toBeLessThanOrEqual(50);
    });

    it('should be monotonically increasing', () => {
      const r1 = SecurityEngine.applySaturation(10, 50);
      const r2 = SecurityEngine.applySaturation(20, 50);
      const r3 = SecurityEngine.applySaturation(50, 50);
      expect(r2).toBeGreaterThan(r1);
      expect(r3).toBeGreaterThan(r2);
    });
  });

  describe('computeTrend', () => {
    it('should return stable for empty history', () => {
      const result = SecurityEngine.computeTrend([]);
      expect(result).toEqual({ direction: 'stable', delta: 0, history: [] });
    });

    it('should return stable for single point', () => {
      const result = SecurityEngine.computeTrend([{ date: '2026-03-07', score: 85 }]);
      expect(result.direction).toBe('stable');
      expect(result.delta).toBe(0);
      expect(result.history).toHaveLength(1);
    });

    it('should detect improving trend', () => {
      const history = [
        { date: '2026-02-28', score: 60 },
        { date: '2026-03-01', score: 65 },
        { date: '2026-03-03', score: 72 },
        { date: '2026-03-05', score: 80 },
        { date: '2026-03-07', score: 88 },
      ];
      const result = SecurityEngine.computeTrend(history);
      expect(result.direction).toBe('improving');
      expect(result.delta).toBeGreaterThan(0);
    });

    it('should detect declining trend', () => {
      const history = [
        { date: '2026-02-28', score: 95 },
        { date: '2026-03-01', score: 88 },
        { date: '2026-03-03', score: 78 },
        { date: '2026-03-05', score: 70 },
        { date: '2026-03-07', score: 60 },
      ];
      const result = SecurityEngine.computeTrend(history);
      expect(result.direction).toBe('declining');
      expect(result.delta).toBeLessThan(0);
    });

    it('should detect stable trend', () => {
      const history = [
        { date: '2026-03-01', score: 85 },
        { date: '2026-03-03', score: 85 },
        { date: '2026-03-05', score: 86 },
        { date: '2026-03-07', score: 85 },
      ];
      const result = SecurityEngine.computeTrend(history);
      expect(result.direction).toBe('stable');
    });

    it('should compute delta from ~7 days ago', () => {
      const history = [
        { date: '2026-02-28', score: 70 },
        { date: '2026-03-07', score: 85 },
      ];
      const result = SecurityEngine.computeTrend(history);
      expect(result.delta).toBe(15);
    });
  });

  describe('calculateSecurityScore', () => {
    it('should return perfect score with no findings', () => {
      const result = engine.calculateSecurityScore(null, null);
      expect(result.score).toBe(100);
      expect(result.grade).toBe('A');
      expect(result.label).toBe('安全');
    });

    it('should deduct for leakage findings', () => {
      const leakage = {
        findings: [
          { severity: 'critical', createdAt: Date.now() },
        ],
      };
      const result = engine.calculateSecurityScore(leakage, null);
      expect(result.score).toBeLessThan(100);
      expect(result.breakdown.leakage).toBeLessThan(50);
      expect(result.breakdown.exposure).toBe(50);
    });

    it('should deduct for exposure findings', () => {
      const exposure = {
        portFindings: [
          { severity: 'high', reachable: true },
        ],
        tunnelFindings: [],
      };
      const result = engine.calculateSecurityScore(null, exposure);
      expect(result.score).toBeLessThan(100);
      expect(result.breakdown.exposure).toBeLessThan(50);
    });

    it('should deduct for tunnel findings', () => {
      const exposure = {
        portFindings: [],
        tunnelFindings: [{ tool: 'ngrok', pid: 1234 }],
      };
      const result = engine.calculateSecurityScore(null, exposure);
      expect(result.breakdown.exposure).toBeLessThan(50);
    });

    it('should apply time decay - old findings penalize less', () => {
      const now = Date.now();
      const recentLeakage = {
        findings: [{ severity: 'critical', createdAt: now }],
      };
      const oldLeakage = {
        findings: [{ severity: 'critical', createdAt: now - 30 * 24 * 60 * 60 * 1000 }],
      };

      const recentScore = engine.calculateSecurityScore(recentLeakage, null, { now });
      const oldScore = engine.calculateSecurityScore(oldLeakage, null, { now });

      expect(oldScore.score).toBeGreaterThan(recentScore.score);
    });

    it('should treat record timestamps in ISO format as eligible for decay', () => {
      const now = Date.now();
      const oldLeakage = {
        findings: [{ severity: 'critical', createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString() }],
      };

      const result = engine.calculateSecurityScore(oldLeakage, null, { now });
      expect(result.score).toBeGreaterThan(90);
    });

    it('should apply saturation - many low findings do not tank score to 0', () => {
      const leakage = {
        findings: Array.from({ length: 100 }, () => ({
          severity: 'low',
          createdAt: Date.now(),
        })),
      };
      const result = engine.calculateSecurityScore(leakage, null);
      // With saturation, 100 low findings should not bring leakage to 0
      expect(result.breakdown.leakage).toBeGreaterThan(0);
    });

    it('should include trend when scoreHistory provided', () => {
      const result = engine.calculateSecurityScore(null, null, {
        scoreHistory: [
          { date: '2026-03-01', score: 80 },
          { date: '2026-03-07', score: 100 },
        ],
      });
      expect(result.trend).toBeDefined();
      expect(result.trend.direction).toBe('improving');
    });

    it('should not include trend when no scoreHistory', () => {
      const result = engine.calculateSecurityScore(null, null);
      expect(result.trend).toBeUndefined();
    });

    it('should return correct grades', () => {
      // Perfect score
      expect(engine.calculateSecurityScore(null, null).grade).toBe('A');

      // With a critical finding
      const leakage = { findings: [{ severity: 'critical', createdAt: Date.now() }] };
      const result = engine.calculateSecurityScore(leakage, null);
      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
    });
  });
});
