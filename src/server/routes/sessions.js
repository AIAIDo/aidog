import { Router } from 'express';

const router = Router();

/**
 * GET /api/sessions?agent=&project=&search=&days=90&limit=50&offset=0
 * List sessions with summary per session.
 */
router.get('/', (req, res) => {
  try {
    const storage = req.app.get('storage');

    const agent = req.query.agent || undefined;
    const search = (req.query.search || '').trim().toLowerCase() || undefined;
    const days = parseInt(req.query.days, 10) || 90;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const start = Date.now() - days * 24 * 3600_000;
    const end = Date.now();

    const t0 = Date.now();
    const result = storage.listSessions({ agent, search, start, end, limit, offset });
    const agents = storage.listAgents();
    const elapsed = Date.now() - t0;
    console.log(`[sessions] listSessions: ${result.total} sessions, ${elapsed}ms (agent=${agent || '*'}, search=${search || ''}, limit=${limit}, offset=${offset})`);

    res.json({
      total: result.total,
      limit,
      offset,
      agents,
      sessions: result.sessions,
    });
  } catch (err) {
    console.error('[sessions] Error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sessions/:id/messages?page=1&pageSize=20&search=
 * Paginated messages (token_events) for a session.
 */
router.get('/:id/messages', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const sessionId = req.params.id;
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 100);
    const search = (req.query.search || '').trim();

    const t0 = Date.now();
    const result = storage.querySessionMessages(sessionId, { page, pageSize, search });
    const elapsed = Date.now() - t0;
    console.log(`[sessions] querySessionMessages: ${result.pagination.total} messages, ${elapsed}ms (session=${sessionId}, page=${page}, pageSize=${pageSize}, search=${search})`);

    if (result.pagination.total === 0 && page === 1) {
      return res.status(404).json({ error: 'Session not found or no messages' });
    }

    res.json(result);
  } catch (err) {
    console.error('[sessions] Messages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/messages/:msgId
 * Single message detail with full content.
 */
router.get('/messages/:msgId', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const msg = storage.getMessageById(req.params.msgId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json(msg);
  } catch (err) {
    console.error('[sessions] Message detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sessions/:id
 * Session detail with all events.
 */
router.get('/:id', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const sessionId = req.params.id;

    const events = storage.queryBySession(sessionId);

    if (!events || events.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const sorted = events.sort((a, b) => a.timestamp - b.timestamp);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    const models = new Set();

    for (const e of sorted) {
      totalInput += e.inputTokens || 0;
      totalOutput += e.outputTokens || 0;
      totalCacheRead += e.cacheRead || 0;
      totalCacheWrite += e.cacheWrite || 0;
      if (e.model) models.add(e.model);
    }

    res.json({
      sessionId,
      agent: first.agent,
      projectName: first.projectName,
      projectPath: first.projectPath,
      startTime: first.timestamp,
      endTime: last.timestamp,
      eventCount: sorted.length,
      totalInput,
      totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCacheRead,
      totalCacheWrite,
      models: [...models],
      events: sorted,
    });
  } catch (err) {
    console.error('[sessions] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
