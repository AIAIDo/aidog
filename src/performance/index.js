import { v4 as uuidv4 } from 'uuid';
import { estimateCost, getModelTier, getModelPricing } from './pricing.js';

/**
 * PerformanceEngine — computes quality/efficiency KPIs from token_events.
 */
export class PerformanceEngine {
  /**
   * @param {Object} options
   * @param {import('../storage/sqlite.js').SQLiteStorage} options.storage
   */
  constructor({ storage }) {
    this.storage = storage;
  }

  /**
   * Run performance analysis for a time range.
   * @param {Object} [options]
   * @param {number} [options.days=7]
   * @param {string} [options.agent]
   * @returns {Object} Analysis result with metrics, score, and breakdowns
   */
  async analyze(options = {}) {
    const { days = 7, agent } = options;
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1000;

    const events = this.storage.queryByDateRange(start, end, agent);

    if (events.length === 0) {
      return {
        periodStart: start,
        periodEnd: end,
        totalEvents: 0,
        metrics: null,
        agents: [],
        tools: null,
        score: null,
      };
    }

    const sessionMetrics = this.computeSessionMetrics(events);
    const agentComparison = this.computeAgentComparison(events);
    const toolMetrics = this.computeToolMetrics(events);
    const costSummary = this.computeCostSummary(events);

    // Aggregate metrics across all sessions
    const aggregated = this._aggregateSessionMetrics(sessionMetrics, events);
    aggregated.cost = costSummary;

    const score = this.calculatePerformanceScore(aggregated);

    return {
      periodStart: start,
      periodEnd: end,
      totalEvents: events.length,
      metrics: aggregated,
      sessionMetrics,
      agents: agentComparison,
      tools: toolMetrics,
      score,
    };
  }

  /**
   * Compute per-session metrics.
   * @param {Array} events - Parsed token_events rows
   * @returns {Array<Object>} Per-session metrics
   */
  computeSessionMetrics(events) {
    // Group events by session
    const sessions = new Map();
    for (const e of events) {
      if (!sessions.has(e.sessionId)) sessions.set(e.sessionId, []);
      sessions.get(e.sessionId).push(e);
    }

    const results = [];
    for (const [sessionId, sessionEvents] of sessions) {
      // Sort by timestamp
      sessionEvents.sort((a, b) => a.timestamp - b.timestamp);

      const first = sessionEvents[0];
      const last = sessionEvents[sessionEvents.length - 1];
      const durationMs = last.timestamp - first.timestamp;

      // Response latency: user→assistant time gaps
      const latencies = [];
      for (let i = 0; i < sessionEvents.length - 1; i++) {
        const curr = sessionEvents[i];
        const next = sessionEvents[i + 1];
        // Only measure user→assistant or assistant→assistant response time
        if (curr.role === 'user' || (curr.role === 'assistant' && next.role === 'assistant')) {
          const gap = (next.timestamp - curr.timestamp) / 1000; // seconds
          if (gap > 0.5 && gap < 300) {
            latencies.push(gap);
          }
        }
      }
      const avgLatency = latencies.length > 0
        ? latencies.reduce((s, v) => s + v, 0) / latencies.length
        : null;

      // Token counts
      let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
      for (const e of sessionEvents) {
        totalInput += e.inputTokens || 0;
        totalOutput += e.outputTokens || 0;
        totalCacheRead += e.cacheRead || 0;
        totalCacheWrite += e.cacheWrite || 0;
      }

      // Cache efficiency: skip if no input tokens
      const cacheEfficiency = totalInput > 0
        ? totalCacheRead / totalInput
        : null;

      // Token efficiency
      const tokenEfficiency = totalInput > 0
        ? totalOutput / totalInput
        : null;

      // Tool call analysis
      let toolCallCount = 0;
      let toolErrorCount = 0;
      for (const e of sessionEvents) {
        if (e.toolCalls && Array.isArray(e.toolCalls)) {
          for (const tc of e.toolCalls) {
            if (tc.type === 'tool_use') toolCallCount++;
            if (tc.type === 'tool_result' && tc.isError) toolErrorCount++;
          }
        }
      }
      const toolSuccessRate = toolCallCount > 0
        ? 1 - (toolErrorCount / toolCallCount)
        : null;

      // Cost estimate
      let cost = 0;
      for (const e of sessionEvents) {
        cost += estimateCost(
          e.model,
          e.inputTokens || 0,
          e.outputTokens || 0,
          e.cacheRead || 0,
          e.cacheWrite || 0
        );
      }

      const models = [...new Set(sessionEvents.map(e => e.model).filter(Boolean))];

      results.push({
        sessionId,
        agent: first.agent,
        models,
        eventCount: sessionEvents.length,
        durationMs,
        avgLatency,
        totalInput,
        totalOutput,
        totalCacheRead,
        totalCacheWrite,
        cacheEfficiency,
        tokenEfficiency,
        toolCallCount,
        toolErrorCount,
        toolSuccessRate,
        cost,
        startTime: first.timestamp,
        endTime: last.timestamp,
      });
    }

    return results;
  }

  /**
   * Compute agent comparison metrics.
   * @param {Array} events
   * @returns {Array<Object>}
   */
  computeAgentComparison(events) {
    const agents = new Map();
    for (const e of events) {
      const key = e.agent || 'unknown';
      if (!agents.has(key)) {
        agents.set(key, {
          agent: key,
          totalInput: 0,
          totalOutput: 0,
          totalCacheRead: 0,
          totalCacheWrite: 0,
          totalCost: 0,
          eventCount: 0,
          sessions: new Set(),
          models: new Map(),
        });
      }
      const a = agents.get(key);
      a.totalInput += e.inputTokens || 0;
      a.totalOutput += e.outputTokens || 0;
      a.totalCacheRead += e.cacheRead || 0;
      a.totalCacheWrite += e.cacheWrite || 0;
      a.totalCost += estimateCost(
        e.model,
        e.inputTokens || 0,
        e.outputTokens || 0,
        e.cacheRead || 0,
        e.cacheWrite || 0
      );
      a.eventCount++;
      a.sessions.add(e.sessionId);
      if (e.model) {
        a.models.set(e.model, (a.models.get(e.model) || 0) + 1);
      }
    }

    return [...agents.values()].map(a => ({
      agent: a.agent,
      totalInput: a.totalInput,
      totalOutput: a.totalOutput,
      totalCacheRead: a.totalCacheRead,
      totalCacheWrite: a.totalCacheWrite,
      totalTokens: a.totalInput + a.totalOutput,
      totalCost: Math.round(a.totalCost * 10000) / 10000,
      eventCount: a.eventCount,
      sessionCount: a.sessions.size,
      cacheEfficiency: a.totalInput > 0 ? a.totalCacheRead / a.totalInput : 0,
      modelDistribution: Object.fromEntries(a.models),
    }));
  }

  /**
   * Compute tool usage metrics.
   * @param {Array} events
   * @returns {Object}
   */
  computeToolMetrics(events) {
    const tools = new Map();
    let totalCalls = 0;
    let totalErrors = 0;

    for (const e of events) {
      if (!e.toolCalls || !Array.isArray(e.toolCalls)) continue;
      for (const tc of e.toolCalls) {
        if (tc.type === 'tool_use') {
          totalCalls++;
          const name = tc.name || 'unknown';
          if (!tools.has(name)) {
            tools.set(name, {
              name,
              count: 0,
              totalInputSize: 0,
              totalOutputSize: 0,
              errors: 0,
            });
          }
          const t = tools.get(name);
          t.count++;
          t.totalInputSize += tc.inputSize || 0;
          t.totalOutputSize += tc.outputSize || 0;
        }
        if (tc.type === 'tool_result' && tc.isError) {
          totalErrors++;
          // Try to attribute error to the tool
          const name = tc.name || 'unknown';
          if (tools.has(name)) {
            tools.get(name).errors++;
          }
        }
      }
    }

    const toolList = [...tools.values()]
      .map(t => ({
        name: t.name,
        count: t.count,
        avgInputSize: t.count > 0 ? Math.round(t.totalInputSize / t.count) : 0,
        avgOutputSize: t.count > 0 ? Math.round(t.totalOutputSize / t.count) : 0,
        totalInputSize: t.totalInputSize,
        totalOutputSize: t.totalOutputSize,
        errors: t.errors,
        successRate: t.count > 0 ? 1 - (t.errors / t.count) : 1,
      }))
      .sort((a, b) => b.count - a.count);

    const uniqueTools = toolList.length;
    const diversityIndex = totalCalls > 0 ? uniqueTools / totalCalls : 0;

    return {
      totalCalls,
      totalErrors,
      overallSuccessRate: totalCalls > 0 ? 1 - (totalErrors / totalCalls) : 1,
      uniqueTools,
      diversityIndex,
      tools: toolList,
      topByCount: toolList.slice(0, 10),
      topBySize: [...toolList].sort((a, b) => (b.totalInputSize + b.totalOutputSize) - (a.totalInputSize + a.totalOutputSize)).slice(0, 10),
    };
  }

  /**
   * Compute cost summary across all events.
   * @param {Array} events
   * @returns {Object}
   */
  computeCostSummary(events) {
    let totalCost = 0;
    const costByModel = new Map();
    const costByTier = { premium: 0, standard: 0, economy: 0 };

    for (const e of events) {
      const cost = estimateCost(
        e.model,
        e.inputTokens || 0,
        e.outputTokens || 0,
        e.cacheRead || 0,
        e.cacheWrite || 0
      );
      totalCost += cost;

      const model = e.model || 'unknown';
      costByModel.set(model, (costByModel.get(model) || 0) + cost);

      const tier = getModelTier(e.model);
      costByTier[tier] += cost;
    }

    return {
      totalCost: Math.round(totalCost * 10000) / 10000,
      costByModel: Object.fromEntries(
        [...costByModel.entries()]
          .map(([k, v]) => [k, Math.round(v * 10000) / 10000])
          .sort((a, b) => b[1] - a[1])
      ),
      costByTier: {
        premium: Math.round(costByTier.premium * 10000) / 10000,
        standard: Math.round(costByTier.standard * 10000) / 10000,
        economy: Math.round(costByTier.economy * 10000) / 10000,
      },
    };
  }

  /**
   * Aggregate per-session metrics into overall metrics.
   * @param {Array} sessionMetrics
   * @param {Array} events
   * @returns {Object}
   */
  _aggregateSessionMetrics(sessionMetrics, events) {
    if (sessionMetrics.length === 0) return {};

    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
    let totalToolCalls = 0, totalToolErrors = 0;
    const latencies = [];

    for (const sm of sessionMetrics) {
      totalInput += sm.totalInput;
      totalOutput += sm.totalOutput;
      totalCacheRead += sm.totalCacheRead;
      totalCacheWrite += sm.totalCacheWrite;
      totalToolCalls += sm.toolCallCount;
      totalToolErrors += sm.toolErrorCount;
      if (sm.avgLatency != null) latencies.push(sm.avgLatency);
    }

    return {
      totalEvents: events.length,
      totalSessions: sessionMetrics.length,
      totalInput,
      totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCacheRead,
      totalCacheWrite,
      cacheEfficiency: totalInput > 0 ? totalCacheRead / totalInput : 0,
      tokenEfficiency: totalInput > 0 ? totalOutput / totalInput : 0,
      avgLatency: latencies.length > 0
        ? latencies.reduce((s, v) => s + v, 0) / latencies.length
        : null,
      totalToolCalls,
      totalToolErrors,
      toolSuccessRate: totalToolCalls > 0 ? 1 - (totalToolErrors / totalToolCalls) : 1,
      avgSessionDuration: sessionMetrics.length > 0
        ? sessionMetrics.reduce((s, sm) => s + sm.durationMs, 0) / sessionMetrics.length
        : 0,
    };
  }

  /**
   * Calculate performance score (0-100) with 5-dimension breakdown.
   * @param {Object} metrics - Aggregated metrics
   * @returns {Object} { score, grade, label, breakdown }
   */
  calculatePerformanceScore(metrics) {
    if (!metrics || !metrics.totalEvents) {
      return { score: 0, grade: 'N/A', label: 'No Data', breakdown: {} };
    }

    // 1. Cache efficiency (0-25): higher cache hit rate = better
    const cacheRatio = metrics.cacheEfficiency || 0;
    const cacheScore = Math.round(Math.min(25, cacheRatio * 50)); // 50%+ cache = full score

    // 2. Token efficiency (0-25): reasonable output/input ratio
    // Ideal ratio is 0.1-0.5 (assistant outputs less than inputs which include context)
    const tokenRatio = metrics.tokenEfficiency || 0;
    let tokenScore;
    if (tokenRatio <= 0) {
      tokenScore = 0;
    } else if (tokenRatio <= 0.5) {
      tokenScore = 25; // Great efficiency
    } else if (tokenRatio <= 1.0) {
      tokenScore = Math.round(25 - (tokenRatio - 0.5) * 20);
    } else {
      tokenScore = Math.round(Math.max(0, 15 - (tokenRatio - 1.0) * 10));
    }

    // 3. Tool efficiency (0-20): success rate + reasonable payload sizes
    const toolSuccessRate = metrics.toolSuccessRate ?? 1;
    const toolScore = Math.round(toolSuccessRate * 20);

    // 4. Session hygiene (0-15): reasonable session lengths and throughput
    const avgDurationMin = (metrics.avgSessionDuration || 0) / 60_000;
    let sessionScore;
    if (avgDurationMin <= 0) {
      sessionScore = 10; // No duration info, neutral
    } else if (avgDurationMin >= 2 && avgDurationMin <= 60) {
      sessionScore = 15; // Sweet spot
    } else if (avgDurationMin < 2) {
      sessionScore = Math.round(avgDurationMin * 7.5); // Too short
    } else {
      sessionScore = Math.round(Math.max(5, 15 - (avgDurationMin - 60) * 0.1));
    }

    // 5. Cost efficiency (0-15): not overusing premium models
    // Penalise sessions where a large fraction of cost comes from premium-tier models.
    // metrics.cost.costByTier has { premium, standard, economy } and metrics.cost.totalCost is the sum.
    const premiumCost = metrics.cost?.costByTier?.premium || 0;
    const totalCost = metrics.cost?.totalCost || 0;
    const expensiveFraction = totalCost > 0 ? Math.min(premiumCost / totalCost, 1) : 0;
    const costScore = Math.round(15 * (1 - expensiveFraction));

    const score = Math.min(100, cacheScore + tokenScore + toolScore + sessionScore + costScore);
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
    const label = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Fair' : score >= 40 ? 'Poor' : 'Needs Improvement';

    return {
      score,
      grade,
      label,
      breakdown: {
        cacheEfficiency: cacheScore,
        tokenEfficiency: tokenScore,
        toolEfficiency: toolScore,
        sessionHygiene: sessionScore,
        costEfficiency: costScore,
      },
    };
  }

  /**
   * Compute trend from score history using linear regression.
   * Reuses the same algorithm as SecurityEngine.computeTrend.
   * @param {Array<{date: string, score: number}>} scoreHistory
   * @returns {{ direction: string, delta: number, history: Array }}
   */
  static computeTrend(scoreHistory) {
    if (!scoreHistory || scoreHistory.length === 0) {
      return { direction: 'stable', delta: 0, history: [] };
    }

    const history = scoreHistory.map(h => ({ date: h.date, score: h.score }));

    if (history.length < 2) {
      return { direction: 'stable', delta: 0, history };
    }

    const latest = history[history.length - 1];
    const sevenDaysAgo = new Date(latest.date);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysStr = sevenDaysAgo.toISOString().slice(0, 10);
    let closest = history[0];
    for (const h of history) {
      if (h.date <= sevenDaysStr) closest = h;
    }
    const delta = Math.round(latest.score - closest.score);

    const n = history.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += history[i].score;
      sumXY += i * history[i].score;
      sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    let direction = 'stable';
    if (slope > 1.0) direction = 'improving';
    else if (slope < -1.0) direction = 'declining';

    return { direction, delta, history };
  }
}
