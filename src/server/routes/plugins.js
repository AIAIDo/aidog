import { Router } from 'express';

const router = Router();

/**
 * GET /api/plugins
 * List all plugins with status.
 */
router.get('/', async (req, res) => {
  try {
    const pluginRegistry = req.app.get('pluginRegistry');

    if (!pluginRegistry) {
      return res.status(503).json({ error: 'Plugin registry not available' });
    }

    const plugins = pluginRegistry.getAll();
    const results = [];

    for (const plugin of plugins) {
      let available = false;
      try {
        available = await plugin.isAvailable();
      } catch {
        // ignore
      }

      results.push({
        name: plugin.meta.name,
        displayName: plugin.meta.displayName,
        version: plugin.meta.version,
        homepage: plugin.meta.homepage || null,
        available,
        enabled: plugin._enabled !== false,
      });
    }

    res.json({ plugins: results });
  } catch (err) {
    console.error('[plugins] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/plugins/:name/enable
 * Enable a plugin.
 */
router.post('/:name/enable', (req, res) => {
  try {
    const pluginRegistry = req.app.get('pluginRegistry');

    if (!pluginRegistry) {
      return res.status(503).json({ error: 'Plugin registry not available' });
    }

    const plugin = pluginRegistry.getByName(req.params.name);

    if (!plugin) {
      return res.status(404).json({ error: `Plugin "${req.params.name}" not found` });
    }

    plugin._enabled = true;

    res.json({
      name: plugin.meta.name,
      enabled: true,
      message: `Plugin "${plugin.meta.displayName}" enabled`,
    });
  } catch (err) {
    console.error('[plugins] Enable error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/plugins/:name/disable
 * Disable a plugin.
 */
router.post('/:name/disable', (req, res) => {
  try {
    const pluginRegistry = req.app.get('pluginRegistry');

    if (!pluginRegistry) {
      return res.status(503).json({ error: 'Plugin registry not available' });
    }

    const plugin = pluginRegistry.getByName(req.params.name);

    if (!plugin) {
      return res.status(404).json({ error: `Plugin "${req.params.name}" not found` });
    }

    plugin._enabled = false;

    res.json({
      name: plugin.meta.name,
      enabled: false,
      message: `Plugin "${plugin.meta.displayName}" disabled`,
    });
  } catch (err) {
    console.error('[plugins] Disable error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/plugins/current-session
 * Return the most-recently-active live session across all available plugins.
 */
router.get('/current-session', async (req, res) => {
  try {
    const pluginRegistry = req.app.get('pluginRegistry');
    if (!pluginRegistry) return res.json({ session: null });

    const plugins = await pluginRegistry.getAvailable();
    let bestSession = null;

    for (const plugin of plugins) {
      if (typeof plugin.getCurrentSession !== 'function') continue;
      let s;
      try {
        s = await plugin.getCurrentSession();
      } catch {
        continue;
      }
      if (!s) continue;
      if (!bestSession || s.lastActivityAt > bestSession.lastActivityAt) {
        bestSession = { ...s, agent: plugin.meta?.name || 'unknown' };
      }
    }

    if (!bestSession) return res.json({ session: null });

    res.json({
      session: {
        sessionId: bestSession.sessionId || null,
        agent: bestSession.agent,
        project: bestSession.project || null,
        turns: bestSession.eventCount || 0,
        totalTokens:
          (bestSession.usage?.input_tokens || 0) +
          (bestSession.usage?.output_tokens || 0),
        rulesHit: 0,
      },
    });
  } catch (err) {
    console.error('[plugins] current-session error:', err.message);
    res.json({ session: null });
  }
});

export default router;
