import { describe, it, expect } from 'vitest';
import { normalizeReportToRecommendations } from '../../src/web/src/lib/ai-report.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const t = (key) => {
  if (key === 'optimizationOpportunity') return '优化建议';
  if (key === 'noDetailedExplanation') return '暂无详细说明。';
  return key;
};

describe('normalizeReportToRecommendations', () => {
  it('normalizes the original AnalysisReport schema', () => {
    const result = normalizeReportToRecommendations({
      issues: [
        {
          id: 'issue-1',
          severity: 'high',
          title: '减少上下文',
          explanation: '上下文过长',
          impact: { estimatedTokenSavings: 1200 },
          category: 'R1_context_growth',
          recommendations: [{ detail: '拆分会话' }],
        },
      ],
    }, t);

    expect(result).toEqual([
      {
        id: 'issue-1',
        title: '减少上下文',
        description: '上下文过长',
        priority: 'high',
        impact: 1200,
        category: 'R1_context_growth',
        steps: ['拆分会话'],
      },
    ]);
  });

  it('normalizes CLI report schema variants', () => {
    const result = normalizeReportToRecommendations({
      issues: [
        {
          id: 'P0_session_too_long_and_io_bloat',
          severity: 'CRITICAL',
          rules: ['R15_io_ratio', 'R13_session_length'],
          estimatedWastedTokens: 145000000,
          rootCause: '会话太长导致上下文滚雪球',
          actions: [
            { description: '每 15-20 轮主动清理上下文', savingsEstimate: '60-70% of total waste' },
            { config: { content: { preferences: { enableAutoCompact: true } } } },
          ],
        },
        {
          id: 'ISSUE-02',
          severity: 'MEDIUM',
          rule: 'R12_model_mismatch',
          title: '模型选择不当',
          impact: '成本明显偏高',
          actions: [{ description: '简单任务切到 Sonnet' }],
        },
      ],
    }, t);

    expect(result[0]).toMatchObject({
      id: 'P0_session_too_long_and_io_bloat',
      title: 'R15_io_ratio, R13_session_length',
      description: '会话太长导致上下文滚雪球',
      priority: 'critical',
      impact: 145000000,
      category: 'R15_io_ratio, R13_session_length',
    });
    expect(result[0].steps[0]).toBe('每 15-20 轮主动清理上下文 (60-70% of total waste)');
    expect(result[0].steps[1]).toContain('"enableAutoCompact": true');

    expect(result[1]).toMatchObject({
      id: 'ISSUE-02',
      title: '模型选择不当',
      description: '成本明显偏高',
      priority: 'medium',
      impact: 0,
      category: 'R12_model_mismatch',
      steps: ['简单任务切到 Sonnet'],
    });
  });

  it('keeps Analysis page waste fallback logic in source', () => {
    const __filename = fileURLToPath(import.meta.url);
    const source = readFileSync(resolve(dirname(__filename), '../../src/web/src/pages/Analysis.jsx'), 'utf8');
    expect(source).toContain('function getRuleEstimatedWaste(rule)');
    expect(source).toContain('rule.sessions.reduce');
    expect(source).toContain('impact: getRuleEstimatedWaste(rule)');
  });
});
