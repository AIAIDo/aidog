import { Router } from 'express';

const router = Router();

/**
 * Shared watcher state: one set of plugin watchers for all SSE clients.
 * Lazily initialized on first SSE connection, cleaned up when last client disconnects.
 */
let sharedWatcherCleanups = [];
let sharedWatcherInitialized = false;
const sseClients = new Set();

function ensureWatchers(pluginRegistry, storage) {
  if (sharedWatcherInitialized) return;
  sharedWatcherInitialized = true;

  if (!pluginRegistry) return;

  const plugins = pluginRegistry.getAll();

  for (const plugin of plugins) {
    if (plugin._enabled === false) continue;

    try {
      const unsub = plugin.watch((events) => {
        if (storage && events.length > 0) {
          try {
            storage.ingestEvents(events);
          } catch (err) {
            console.error('[watch] Failed to ingest events:', err.message);
          }
        }

        // Broadcast to all SSE clients
        for (const res of sseClients) {
          for (const event of events) {
            const payload = {
              type: 'token_event',
              event: {
                id: event.id,
                agent: event.agentName || event.agent,
                sessionId: event.sessionId || event.session_id,
                model: event.model,
                inputTokens: event.inputTokens ?? event.input_tokens ?? 0,
                outputTokens: event.outputTokens ?? event.output_tokens ?? 0,
                cacheRead: event.cacheReadTokens ?? event.cache_read ?? 0,
                cacheWrite: event.cacheWriteTokens ?? event.cache_write ?? 0,
                timestamp: event.timestamp,
              },
            };
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          }
        }
      });

      if (typeof unsub === 'function') {
        sharedWatcherCleanups.push(unsub);
      }
    } catch (err) {
      console.error(`[watch] Failed to start watcher for ${plugin.meta.name}:`, err.message);
    }
  }
}

function cleanupWatchers() {
  if (sseClients.size > 0) return; // Still have clients

  for (const unsub of sharedWatcherCleanups) {
    try { unsub(); } catch { /* ignore */ }
  }
  sharedWatcherCleanups = [];
  sharedWatcherInitialized = false;
}

/**
 * GET /api/watch/stream
 * SSE stream for real-time token events.
 * Uses shared watchers — one watcher set regardless of client count.
 */
router.get('/stream', (req, res) => {
  const pluginRegistry = req.app.get('pluginRegistry');
  const storage = req.app.get('storage');

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

  // Add client
  sseClients.add(res);

  // Ensure shared watchers are running
  ensureWatchers(pluginRegistry, storage);

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
  }, 30000);

  // Listen for scheduler analysis events
  const scheduler = req.app.get('scheduler');
  const onAnalysis = (result) => {
    res.write(
      `data: ${JSON.stringify({
        type: 'analysis_complete',
        healthScore: result.healthScore,
        totalTokens: result.totalTokens,
        timestamp: Date.now(),
      })}\n\n`,
    );
  };

  if (scheduler) {
    scheduler.on('analysis', onAnalysis);
  }

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    if (scheduler) {
      scheduler.off('analysis', onAnalysis);
    }
    cleanupWatchers();
  });
});

export default router;
