import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { existsSync, createReadStream } from 'fs';
import { AnalysisScheduler } from './scheduler.js';

import statsRouter from './routes/stats.js';
import sessionsRouter from './routes/sessions.js';
import { analysisRouter, analyzeRouter } from './routes/analysis.js';
import { aiRouter, applyRouter } from './routes/optimize.js';
import pluginsRouter from './routes/plugins.js';
import watchRouter from './routes/watch.js';
import securityRouter from './routes/security.js';
import rulesRouter from './routes/rules.js';
import performanceRouter from './routes/performance.js';
import { SecurityEngine } from '../security/index.js';
import { PerformanceEngine } from '../performance/index.js';
import { RuleManager } from '../rules/rule-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Create and configure the aidog Express server.
 *
 * @param {Object} options
 * @param {import('../storage/sqlite.js').SQLiteStorage} options.storage
 * @param {import('../rules/engine.js').RuleEngine} options.ruleEngine
 * @param {Object} [options.aiManager] - AI adapter instance (e.g. ClaudeAdapter)
 * @param {import('../plugins/registry.js').PluginRegistry} [options.pluginRegistry]
 * @param {number} [options.port=3000]
 * @param {boolean} [options.enableWatch=false]
 * @param {number} [options.analyzeInterval=30] - Analysis interval in minutes
 * @returns {{ app: express.Application, start: () => Promise<import('http').Server>, scheduler: AnalysisScheduler }}
 */
export function createServer(options) {
  const {
    storage,
    ruleEngine,
    aiManager,
    pluginRegistry,
    port = 9527,
    enableWatch = false,
    analyzeInterval = 30,
  } = options;

  const app = express();

  // --- Middleware ---

  // Debug: log all incoming API requests
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      console.log(`[debug] INCOMING ${req.method} ${req.path}`);
    }
    next();
  });

  // CORS for local development
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // JSON body parsing
  app.use(express.json());

  // Serve static files from the web UI build directory
  const staticDir = join(__dirname, '..', 'web', 'dist');
  app.use(express.static(staticDir));

  // Serve saved images from ~/.aidog/images/
  // Custom handler because express.static rejects filenames with colons
  const imagesDir = join(homedir(), '.aidog', 'images');
  app.use('/api/images', (req, res, next) => {
    // req.path has the prefix stripped, e.g. "/claude-code:user:xxx_0.png"
    const fileName = decodeURIComponent(req.path.replace(/^\//, ''));
    if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return next();
    }
    const filePath = join(imagesDir, fileName);
    if (!existsSync(filePath)) {
      return next();
    }
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    createReadStream(filePath).pipe(res);
  });

  // --- App-level context (accessible via req.app.get) ---
  app.set('storage', storage);
  app.set('ruleEngine', ruleEngine);
  app.set('aiManager', aiManager || null);
  app.set('pluginRegistry', pluginRegistry || null);

  // Initialize security engine
  const securityEngine = new SecurityEngine({ storage, pluginRegistry });
  app.set('securityEngine', securityEngine);

  // Initialize performance engine
  const performanceEngine = new PerformanceEngine({ storage });
  app.set('performanceEngine', performanceEngine);

  // Initialize rule manager
  const ruleManager = new RuleManager({ storage, ruleEngine, securityEngine });
  ruleManager.loadAndSync();
  app.set('ruleManager', ruleManager);

  // --- Scheduler setup ---
  const scheduler = new AnalysisScheduler(storage, ruleEngine, analyzeInterval);
  app.set('scheduler', scheduler);

  // --- SSE endpoint for real-time scheduler events ---
  const sseClients = new Set();

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    sseClients.add(res);

    const heartbeat = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Forward scheduler events to all SSE clients
  scheduler.on('analysis', (result) => {
    const payload = JSON.stringify({
      type: 'analysis_complete',
      healthScore: result.healthScore,
      totalTokens: result.totalTokens,
      totalWastedTokens: result.totalWastedTokens,
      timestamp: Date.now(),
    });
    for (const client of sseClients) {
      client.write(`data: ${payload}\n\n`);
    }
  });

  // --- API routes ---
  app.use('/api/stats', statsRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/analysis', analysisRouter);
  app.use('/api/analyze', analyzeRouter);
  app.use('/api/analyze', aiRouter);
  app.use('/api/apply', applyRouter);
  app.use('/api/plugins', pluginsRouter);
  app.use('/api/watch', watchRouter);
  app.use('/api/security', securityRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api/performance', performanceRouter);

  // --- 404 for unmatched API routes (prevent connection hanging) ---
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });

  // --- SPA fallback: serve index.html for non-API routes ---
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    res.sendFile(join(staticDir, 'index.html'), (err) => {
      if (err) {
        // Static files not built yet, return a helpful message
        res.status(200).json({
          message: 'aidog API server is running. Web UI not built yet.',
          hint: 'Run "npm run build:web" to build the web UI.',
        });
      }
    });
  });

  // --- Error handler ---
  app.use((err, req, res, _next) => {
    console.error('[server] Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  /**
   * Start the server and scheduler.
   * @returns {Promise<import('http').Server>}
   */
  function start() {
    return new Promise((resolve) => {
      const server = app.listen(port, () => {
        console.log(`[aidog] Server running at http://localhost:${port}`);

        // Start the analysis scheduler
        scheduler.start();
        console.log(`[aidog] Analysis scheduler started (interval: ${analyzeInterval}m)`);

        // Start watching for real-time events if enabled
        if (enableWatch && pluginRegistry) {
          startWatchers(pluginRegistry, storage);
        }

        resolve(server);
      });

      // Graceful shutdown
      const shutdown = () => {
        console.log('\n[aidog] Shutting down...');
        scheduler.stop();
        server.close(() => {
          console.log('[aidog] Server stopped');
          process.exit(0);
        });
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  }

  return { app, start, scheduler };
}

/**
 * Start file watchers for all available plugins.
 * @param {import('../plugins/registry.js').PluginRegistry} pluginRegistry
 * @param {import('../storage/sqlite.js').SQLiteStorage} storage
 */
function startWatchers(pluginRegistry, storage) {
  const plugins = pluginRegistry.getAll();

  for (const plugin of plugins) {
    if (plugin._enabled === false) continue;

    try {
      plugin.watch((events) => {
        if (events && events.length > 0) {
          try {
            storage.ingestEvents(events);
            console.log(`[watch] Ingested ${events.length} events from ${plugin.meta.name}`);
          } catch (err) {
            console.error(`[watch] Failed to ingest events from ${plugin.meta.name}:`, err.message);
          }
        }
      });
      console.log(`[aidog] Watching ${plugin.meta.displayName} for new events`);
    } catch (err) {
      console.error(`[aidog] Failed to start watcher for ${plugin.meta.name}:`, err.message);
    }
  }
}
