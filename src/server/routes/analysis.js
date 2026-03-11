import { Router } from 'express';

/**
 * Router for /api/analysis/* routes (read-only analysis data).
 */
export const analysisRouter = Router();

/**
 * Router for /api/analyze/* routes (trigger/schedule actions).
 * These are merged with the optimize router in server/index.js.
 */
export const analyzeRouter = Router();

/**
 * GET /api/analysis?days=7
 * Latest analysis results.
 */
analysisRouter.get('/', (req, res) => {
  try {
    const storage = req.app.get('storage');

    const batch = storage.getLatestBatch();

    if (!batch) {
      return res.json({
        batch: null,
        results: [],
        message: 'No analysis has been run yet',
      });
    }

    // Get all results for this batch
    const stmt = storage.db.prepare(
      'SELECT * FROM analysis_results WHERE batch_id = ? ORDER BY severity DESC, created_at DESC',
    );
    const results = stmt.all(batch.id);

    // Parse evidence JSON
    const parsed = results.map((r) => ({
      ...r,
      evidence: (() => {
        try {
          return JSON.parse(r.evidence);
        } catch {
          return [];
        }
      })(),
    }));

    const history = storage.db.prepare(
      'SELECT health_score, created_at FROM analysis_batches ORDER BY created_at DESC, rowid DESC LIMIT 2',
    ).all();
    const previousBatch = history[1] || null;
    let previousScore = null;
    if (previousBatch?.health_score) {
      try {
        previousScore = JSON.parse(previousBatch.health_score)?.score ?? null;
      } catch {
        previousScore = null;
      }
    }

    const healthScore = batch.health_score
      ? {
        ...batch.health_score,
        previousScore,
        trend: previousScore == null
          ? batch.health_score?.trend || 'stable'
          : batch.health_score.score > previousScore
            ? 'improving'
            : batch.health_score.score < previousScore
              ? 'declining'
              : 'stable',
      }
      : null;

    const summary = parsed.map((r) => ({
      rule: r.rule,
      ruleId: r.rule,
      severity: r.severity,
      occurrences: 1,
      estimatedWastedTokens: r.estimated_wasted_tokens || 0,
      detail: (() => {
        try {
          return r.detail ? JSON.parse(r.detail) : null;
        } catch {
          return null;
        }
      })(),
    }));

    res.json({
      healthScore,
      totalTokens: batch.total_tokens,
      totalWastedTokens: batch.total_wasted,
      summary,
      batch: {
        id: batch.id,
        periodStart: batch.period_start,
        periodEnd: batch.period_end,
        totalTokens: batch.total_tokens,
        totalWasted: batch.total_wasted,
        healthScore,
        ruleCount: batch.rule_count,
        createdAt: batch.created_at,
      },
      results: parsed,
    });
  } catch (err) {
    console.error('[analysis] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analysis/summary
 * Rule hit results grouped by rule (occurrences, sessions, severity).
 * Must be defined BEFORE /:id routes to prevent Express matching 'summary' as an id.
 */
analysisRouter.get('/summary', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const batch = storage.getLatestBatch();
    if (!batch) return res.json({ rules: [], batch: null });

    const rows = storage.db.prepare(
      `SELECT rule, severity, session_id, agent, detail, estimated_wasted_tokens
       FROM analysis_results WHERE batch_id = ?
       ORDER BY rule, created_at DESC`
    ).all(batch.id);
    const titleMap = storage.getSessionTitles(
      [...new Set(rows.map((row) => row.session_id).filter(Boolean))]
    );

    const byRule = {};
    for (const row of rows) {
      const estimatedWaste = row.estimated_wasted_tokens ?? 0;
      if (!byRule[row.rule]) {
        byRule[row.rule] = {
          id: row.rule, name: row.rule,
          severity: (row.severity || 'medium').toLowerCase(),
          occurrences: 0, estimatedWaste: 0, sessions: [],
        };
      }
        const r = byRule[row.rule];
      r.occurrences += 1;
      r.estimatedWaste += estimatedWaste;
      if (row.session_id) {
        r.sessions.push({
          sessionId: row.session_id,
          title: titleMap[row.session_id] || null,
          agent: row.agent || null,
          waste: estimatedWaste,
          detail: (() => { try { return JSON.parse(row.detail); } catch { return null; } })(),
        });
      }
    }

    res.json({
      rules: Object.values(byRule),
      batch: {
        totalTokens: batch.total_tokens,
        totalWasted: batch.total_wasted,
        healthScore: batch.health_score,
        periodStart: batch.period_start,
        periodEnd: batch.period_end,
        createdAt: batch.created_at,
      },
    });
  } catch (err) {
    console.error('[analysis] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analysis/:id/evidence
 * Evidence for a specific analysis result.
 */
analysisRouter.get('/:id/evidence', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const resultId = req.params.id;

    const stmt = storage.db.prepare(
      'SELECT * FROM analysis_results WHERE id = ?',
    );
    const result = stmt.get(resultId);

    if (!result) {
      return res.status(404).json({ error: 'Analysis result not found' });
    }

    let evidence = [];
    try {
      evidence = JSON.parse(result.evidence);
    } catch {
      // ignore
    }

    // If evidence contains event IDs, fetch those events
    let relatedEvents = [];
    if (Array.isArray(evidence) && evidence.length > 0) {
      const eventIds = evidence
        .filter((e) => typeof e === 'string' || e?.eventId)
        .map((e) => (typeof e === 'string' ? e : e.eventId));

      if (eventIds.length > 0) {
        relatedEvents = storage.getEventsByIds(eventIds);
      }
    }

    res.json({
      result: {
        ...result,
        evidence,
      },
      relatedEvents,
    });
  } catch (err) {
    console.error('[analysis] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analysis/rule/:ruleId/sessions
 * Sessions that triggered a specific rule.
 */
analysisRouter.get('/rule/:ruleId/sessions', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const ruleId = req.params.ruleId;

    const stmt = storage.db.prepare(
      'SELECT DISTINCT session_id, agent, severity, detail, suggestion FROM analysis_results WHERE rule = ? ORDER BY created_at DESC LIMIT 100',
    );
    const results = stmt.all(ruleId);

    res.json({
      ruleId,
      count: results.length,
      sessions: results.map((r) => ({
        sessionId: r.session_id,
        agent: r.agent,
        severity: r.severity,
        detail: r.detail,
        suggestion: r.suggestion,
      })),
    });
  } catch (err) {
    console.error('[analysis] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/analyze/trigger
 * Trigger immediate analysis.
 */
analyzeRouter.post('/trigger', async (req, res) => {
  try {
    const scheduler = req.app.get('scheduler');

    if (!scheduler) {
      return res.status(503).json({ error: 'Scheduler not available' });
    }

    const result = await scheduler.triggerNow();

    if (result === null) {
      return res.status(409).json({
        error: 'Analysis is already running',
        status: scheduler.getScheduleStatus(),
      });
    }

    res.json({
      message: 'Analysis completed',
      healthScore: result.healthScore,
      totalTokens: result.totalTokens,
      totalWastedTokens: result.totalWastedTokens,
      ruleCount: result.byRule ? Object.keys(result.byRule).length : 0,
    });
  } catch (err) {
    console.error('[analysis] Trigger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analyze/schedule
 * Scheduler status.
 */
analyzeRouter.get('/schedule', (req, res) => {
  try {
    const scheduler = req.app.get('scheduler');

    if (!scheduler) {
      return res.status(503).json({ error: 'Scheduler not available' });
    }

    res.json(scheduler.getScheduleStatus());
  } catch (err) {
    console.error('[analysis] Schedule error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
