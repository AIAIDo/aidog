import { Router } from 'express';
import { PerformanceEngine } from '../../performance/index.js';
import { localhostOnly } from '../middleware/localhost-only.js';

const router = Router();

let lastAnalyzeTime = 0;
const MIN_ANALYZE_INTERVAL = 30_000;

/**
 * POST /api/performance/analyze/trigger
 */
router.post('/analyze/trigger', localhostOnly, async (req, res) => {
  const now = Date.now();
  if (now - lastAnalyzeTime < MIN_ANALYZE_INTERVAL) {
    return res.status(429).json({
      error: 'Analysis rate limited',
      retryAfterMs: MIN_ANALYZE_INTERVAL - (now - lastAnalyzeTime),
    });
  }
  lastAnalyzeTime = now;

  try {
    const performanceEngine = req.app.get('performanceEngine');
    if (!performanceEngine) {
      return res.status(500).json({ error: 'Performance engine not initialized' });
    }

    const { days = 7, agent } = req.body || {};
    const result = await performanceEngine.analyze({ days, agent });

    // Save snapshot
    const storage = req.app.get('storage');
    if (storage && result.score) {
      const scoreTimeline = storage.getPerformanceScoreTimeline(30);
      result.score.trend = PerformanceEngine.computeTrend(scoreTimeline);

      storage.savePerformanceSnapshot({
        snapshotType: 'full',
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        agent: agent || null,
        metrics: result.metrics,
        score: result.score,
      });
    }

    res.json({ status: 'completed', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/performance/latest
 */
router.get('/latest', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const snapshot = storage.getLatestPerformanceSnapshot('full');
    if (!snapshot) {
      return res.status(404).json({ error: 'No performance snapshot found' });
    }

    // Attach trend
    if (snapshot.score) {
      const timeline = storage.getPerformanceScoreTimeline(30);
      snapshot.score.trend = PerformanceEngine.computeTrend(timeline);
    }

    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/performance/overview
 * Real-time KPI computation (does not depend on snapshots).
 */
router.get('/overview', async (req, res) => {
  try {
    const performanceEngine = req.app.get('performanceEngine');
    if (!performanceEngine) {
      return res.status(500).json({ error: 'Performance engine not initialized' });
    }

    const days = parseInt(req.query.days || '7', 10);
    const agent = req.query.agent || undefined;
    const result = await performanceEngine.analyze({ days, agent });

    // Include trend from saved snapshots
    const storage = req.app.get('storage');
    if (storage && result.score) {
      const timeline = storage.getPerformanceScoreTimeline(30);
      result.score.trend = PerformanceEngine.computeTrend(timeline);
    }

    if (req.query.compact === '1') {
      const top5 = (result.sessionMetrics || [])
        .slice()
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

      // Look up session titles from storage
      const titleMap = storage
        ? storage.getSessionTitles(top5.map(s => s.sessionId))
        : {};

      const topSessions = top5.map((sm) => ({
          sessionId: sm.sessionId,
          title: titleMap[sm.sessionId] || null,
          eventCount: sm.eventCount,
          cost: sm.cost,
          cacheEfficiency: sm.cacheEfficiency,
          models: sm.models,
        }));

      return res.json({
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        totalEvents: result.totalEvents,
        metrics: result.metrics,
        score: result.score,
        sessionMetrics: topSessions,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/performance/agents
 */
router.get('/agents', async (req, res) => {
  try {
    const performanceEngine = req.app.get('performanceEngine');
    if (!performanceEngine) {
      return res.status(500).json({ error: 'Performance engine not initialized' });
    }

    const days = parseInt(req.query.days || '7', 10);
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1000;
    const events = performanceEngine.storage.queryByDateRange(start, end);
    const allAgents = performanceEngine.computeAgentComparison(events);

    const total = allAgents.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const offset = (page - 1) * pageSize;

    res.json({
      agents: allAgents.slice(offset, offset + pageSize),
      pagination: { page, pageSize, total, totalPages },
      days,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/performance/tools/agents-summary
 * Returns per-agent tool usage summary for filter cards.
 */
router.get('/tools/agents-summary', async (req, res) => {
  try {
    const performanceEngine = req.app.get('performanceEngine');
    if (!performanceEngine) {
      return res.status(500).json({ error: 'Performance engine not initialized' });
    }

    const days = parseInt(req.query.days || '7', 10);
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1000;
    const events = performanceEngine.storage.queryByDateRange(start, end);

    // Group events by agent
    const byAgent = new Map();
    for (const e of events) {
      const key = e.agent || 'unknown';
      if (!byAgent.has(key)) byAgent.set(key, []);
      byAgent.get(key).push(e);
    }

    const agents = [];
    for (const [agent, agentEvents] of byAgent) {
      const metrics = performanceEngine.computeToolMetrics(agentEvents);
      agents.push({
        agent,
        totalCalls: metrics.totalCalls,
        overallSuccessRate: metrics.overallSuccessRate,
        uniqueTools: metrics.uniqueTools,
      });
    }
    agents.sort((a, b) => b.totalCalls - a.totalCalls);

    res.json({ agents, days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/performance/tools
 */
router.get('/tools', async (req, res) => {
  try {
    const performanceEngine = req.app.get('performanceEngine');
    if (!performanceEngine) {
      return res.status(500).json({ error: 'Performance engine not initialized' });
    }

    const days = parseInt(req.query.days || '7', 10);
    const agent = req.query.agent || undefined;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1000;
    const events = performanceEngine.storage.queryByDateRange(start, end, agent);
    const result = performanceEngine.computeToolMetrics(events);

    const total = result.tools.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const offset = (page - 1) * pageSize;

    res.json({
      ...result,
      tools: result.tools.slice(offset, offset + pageSize),
      pagination: { page, pageSize, total, totalPages },
      days,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/performance/history
 */
router.get('/history', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const days = parseInt(req.query.days || '30', 10);
    const history = storage.getPerformanceHistory(days);
    const timeline = storage.getPerformanceScoreTimeline(days);
    const trendData = PerformanceEngine.computeTrend(timeline);

    res.json({ history, trend: trendData.direction, trendData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
