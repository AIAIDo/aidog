import { Router } from 'express';

/**
 * Router for /api/analyze/ai* routes (AI-powered analysis).
 */
export const aiRouter = Router();

/**
 * Router for /api/apply/:fixId routes (apply optimization fixes).
 */
export const applyRouter = Router();

/**
 * POST /api/analyze/ai
 * Trigger AI analysis.
 */
aiRouter.post('/ai', async (req, res) => {
  try {
    const storage = req.app.get('storage');
    const ruleEngine = req.app.get('ruleEngine');
    const aiManager = req.app.get('aiManager');

    if (!aiManager) {
      return res.status(503).json({ error: 'AI manager not configured' });
    }

    const days = parseInt(req.body?.days, 10) || 7;
    const agent = req.body?.agent || undefined;

    // Gather data
    const now = Date.now();
    const start = now - days * 24 * 60 * 60 * 1000;
    const events = storage.queryByDateRange(start, now, agent);

    if (!events || events.length === 0) {
      return res.status(404).json({ error: 'No events found for the specified period' });
    }

    // Run rule analysis first
    const ruleResult = await ruleEngine.analyze(events);

    // Build analysis data for AI
    const analysisData = {
      period: `${days} days`,
      agent: agent || 'all',
      totalTokens: ruleResult.totalTokens,
      totalWastedTokens: ruleResult.totalWastedTokens,
      healthScore: ruleResult.healthScore,
      summary: ruleResult.summary,
      sessionCount: new Set(events.map((e) => e.sessionId)).size,
      eventCount: events.length,
    };

    // Check for cached report
    const inputHash = hashData(analysisData);
    const cached = storage.getAIReport(inputHash);
    if (cached) {
      return res.json({
        cached: true,
        report: cached.report,
        modelUsed: cached.model_used,
        createdAt: cached.created_at,
      });
    }

    // Run AI analysis via AIManager (non-streaming)
    let adapter;
    try {
      adapter = await aiManager.selectAdapter();
    } catch (err) {
      return res.status(503).json({ error: err.message });
    }

    const report = await aiManager.analyze(analysisData);

    // Save report
    const modelUsed = adapter.meta?.name || 'unknown';
    storage.saveAIReport({
      period: `${days}d`,
      agent: agent || 'all',
      inputHash,
      report,
      modelUsed,
    });

    res.json({
      cached: false,
      report,
      modelUsed,
    });
  } catch (err) {
    console.error('[optimize] AI analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analyze/ai/stream
 * SSE stream for AI analysis results.
 */
aiRouter.get('/ai/stream', async (req, res) => {
  const storage = req.app.get('storage');
  const ruleEngine = req.app.get('ruleEngine');
  const aiManager = req.app.get('aiManager');

  if (!aiManager) {
    return res.status(503).json({ error: 'AI manager not configured' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const days = parseInt(req.query.days, 10) || 7;
    const agent = req.query.agent || undefined;

    const now = Date.now();
    const start = now - days * 24 * 60 * 60 * 1000;
    const events = storage.queryByDateRange(start, now, agent);

    if (!events || events.length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'No events found' })}\n\n`);
      res.end();
      return;
    }

    const ruleResult = await ruleEngine.analyze(events);

    const analysisData = {
      period: `${days} days`,
      agent: agent || 'all',
      totalTokens: ruleResult.totalTokens,
      totalWastedTokens: ruleResult.totalWastedTokens,
      healthScore: ruleResult.healthScore,
      summary: ruleResult.summary,
      sessionCount: new Set(events.map((e) => e.sessionId)).size,
      eventCount: events.length,
    };

    res.write(`data: ${JSON.stringify({ type: 'start', analysisData })}\n\n`);

    let adapter;
    try {
      adapter = await aiManager.selectAdapter();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', code: 'NO_PROVIDER', message: err.message })}\n\n`);
      res.end();
      return;
    }

    const report = await aiManager.analyze(analysisData, {
      stream: true,
      onChunk: (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
      },
    });

    // Save
    const inputHash = hashData(analysisData);
    const modelUsed = adapter.meta?.name || 'unknown';
    storage.saveAIReport({
      period: `${days}d`,
      agent: agent || 'all',
      inputHash,
      report,
      modelUsed,
    });

    res.write(`data: ${JSON.stringify({ type: 'done', report })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[optimize] AI stream error:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/apply/:fixId
 * Apply an optimization fix.
 */
applyRouter.post('/:fixId', async (req, res) => {
  try {
    const fixId = req.params.fixId;
    const body = req.body || {};

    switch (fixId) {
      case 'mcp-cleanup': {
        // Provide guidance on MCP server cleanup
        res.json({
          fixId,
          status: 'guidance',
          message: 'MCP cleanup requires manual review of your Claude Code configuration.',
          steps: [
            'Open your Claude Code MCP settings',
            'Review the list of connected MCP servers',
            'Disable or remove servers that are not actively used',
            'Restart Claude Code to apply changes',
          ],
        });
        break;
      }

      case 'cache-hint': {
        // Provide guidance on improving cache hit rates
        res.json({
          fixId,
          status: 'guidance',
          message: 'Cache optimization recommendations.',
          steps: [
            'Keep system prompts consistent across requests',
            'Place frequently changing content at the end of prompts',
            'Use CLAUDE.md files for project context (cached automatically)',
            'Avoid unnecessary prompt modifications between turns',
          ],
          config: body.config || null,
        });
        break;
      }

      default:
        res.status(404).json({ error: `Unknown fix: ${fixId}` });
    }
  } catch (err) {
    console.error('[optimize] Apply fix error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Simple hash function for deduplication.
 */
function hashData(data) {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return String(hash);
}
