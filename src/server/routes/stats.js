import { Router } from 'express';

const COST_PER_1K_INPUT = 0.003;
const COST_PER_1K_OUTPUT = 0.015;
const COST_PER_1K_CACHE_READ = 0.0003;
const COST_PER_1K_CACHE_WRITE = 0.00375;

/**
 * Estimate cost in USD from token counts.
 */
function estimateCost(input, output, cacheRead, cacheWrite) {
  return (
    (input / 1000) * COST_PER_1K_INPUT +
    (output / 1000) * COST_PER_1K_OUTPUT +
    (cacheRead / 1000) * COST_PER_1K_CACHE_READ +
    (cacheWrite / 1000) * COST_PER_1K_CACHE_WRITE
  );
}

const router = Router();

/**
 * GET /api/stats?days=7&agent=all
 * Returns summary stats with health score.
 */
router.get('/', async (req, res) => {
  try {
    const storage = req.app.get('storage');
    const ruleEngine = req.app.get('ruleEngine');

    const days = parseInt(req.query.days, 10) || 7;
    const agent = req.query.agent === 'all' ? undefined : req.query.agent;
    const compact = req.query.compact === '1';

    const dailySummary = storage.getDailySummary(days, agent);

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let sessions = 0;

    for (const row of dailySummary) {
      totalInput += row.totalInput || 0;
      totalOutput += row.totalOutput || 0;
      totalCacheRead += row.totalCacheRead || 0;
      totalCacheWrite += row.totalCacheWrite || 0;
      sessions += row.sessionCount || 0;
    }

    const totalTokens = totalInput + totalOutput;
    const estimatedCost = estimateCost(totalInput, totalOutput, totalCacheRead, totalCacheWrite);

    if (compact) {
      return res.json({
        totalTokens,
        totalInput,
        totalOutput,
        totalCacheRead,
        totalCacheWrite,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
        sessions,
        dailySummary,
      });
    }

    // Get health score from rule engine analysis
    let healthScore = { score: 100, grade: 'A', label: 'No data' };
    let modelDistribution = {};

    if (totalTokens > 0) {
      const now = Date.now();
      const start = now - days * 24 * 60 * 60 * 1000;
      const events = storage.queryByDateRange(start, now, agent);

      if (events.length > 0) {
        const analysis = await ruleEngine.analyze(events);
        healthScore = analysis.healthScore;

        // Build model distribution
        for (const event of events) {
          const model = event.model || 'unknown';
          if (!modelDistribution[model]) {
            modelDistribution[model] = { count: 0, tokens: 0 };
          }
          modelDistribution[model].count++;
          modelDistribution[model].tokens += (event.inputTokens || 0) + (event.outputTokens || 0);
        }
      }
    }

    res.json({
      totalTokens,
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheWrite,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      sessions,
      dailySummary,
      healthScore,
      modelDistribution,
    });
  } catch (err) {
    console.error('[stats] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
