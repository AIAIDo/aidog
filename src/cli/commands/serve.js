import chalk from 'chalk';
import ora from 'ora';

/**
 * Register the `aidog serve` command.
 * @param {import('commander').Command} program
 */
export function registerServeCommand(program) {
  program
    .command('serve')
    .description('启动 Web Dashboard')
    .option('--port <n>', '端口号', '9527')
    .option('--no-watch', '不启动内置 watcher')
    .option('--analyze-interval <minutes>', '自动分析间隔（分钟，设 0 禁用）', '10')
    .action(async (options) => {
      try {
        await runServe(options);
      } catch (err) {
        console.error(chalk.red(`\nServer failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

async function runServe(options) {
  const port = parseInt(options.port, 10) || 9527;
  const analyzeInterval = parseInt(options.analyzeInterval, 10);
  const enableWatch = options.watch !== false;

  console.log(chalk.bold('\n🚀 Starting aidog Web Dashboard\n'));

  const spinner = ora('Loading modules...').start();

  let express, SQLiteStorage, PluginRegistry, createRuleEngine;

  try {
    const expressModule = await import('express');
    express = expressModule.default;
    const storageModule = await import('../../storage/index.js');
    SQLiteStorage = storageModule.SQLiteStorage;
    const pluginsModule = await import('../../plugins/registry.js');
    PluginRegistry = pluginsModule.PluginRegistry;
    const rulesModule = await import('../../rules/index.js');
    createRuleEngine = rulesModule.createRuleEngine;
  } catch (err) {
    spinner.fail(`Failed to load modules: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const storage = new SQLiteStorage();
  const registry = new PluginRegistry();
  await registry.loadUserPlugins();
  const ruleEngine = createRuleEngine();

  const app = express();
  app.use(express.json());

  // Make storage accessible to routers via req.app.get('storage')
  app.set('storage', storage);
  app.set('ruleEngine', ruleEngine);
  app.set('pluginRegistry', registry);

  // --- Background provider discovery (runs at startup, cached) ---
  let discoveryCache = null;
  let discoveryPromise = null;

  async function runProviderDiscovery() {
    const { ConfigDiscovery } = await import('../../ai/config-discovery.js');
    const { AIManager } = await import('../../ai/index.js');
    const disc = new ConfigDiscovery();
    const discovered = await disc.discover();
    const aiManager = new AIManager();
    const available = await aiManager.getAvailable();
    const availableNames = available.map(a => a.meta.name);

    let savedConfig = {};
    try {
      const { readFileSync } = await import('fs');
      const { join: pathJoin } = await import('path');
      const { homedir: getHome } = await import('os');
      savedConfig = JSON.parse(readFileSync(pathJoin(getHome(), '.aidog', 'config.json'), 'utf-8'));
    } catch { /* no saved config */ }

    const manualConfigs = savedConfig.providerConfigs || {};
    const hasManual = (name) => { const c = manualConfigs[name]; return !!(c && (c.apiKey || c.baseURL)); };

    const providers = [
      { name: 'claude', displayName: 'Anthropic Claude', available: availableNames.includes('claude'), manuallyConfigured: hasManual('claude'), source: hasManual('claude') && !discovered.anthropicApiKey ? 'manual config' : (discovered.anthropicApiKey ? detectSource(discovered, 'anthropicApiKey') : null), models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'] },
      { name: 'openai', displayName: 'OpenAI', available: availableNames.includes('openai'), manuallyConfigured: hasManual('openai'), source: hasManual('openai') && !discovered.openaiApiKey ? 'manual config' : (discovered.openaiApiKey ? detectSource(discovered, 'openaiApiKey') : null), models: ['gpt-4o', 'gpt-4o-mini', 'o1'] },
      { name: 'gemini', displayName: 'Google Gemini', available: availableNames.includes('gemini'), manuallyConfigured: hasManual('gemini'), source: hasManual('gemini') && !discovered.geminiApiKey ? 'manual config' : (discovered.geminiApiKey ? detectSource(discovered, 'geminiApiKey') : null), models: ['gemini-2.0-flash', 'gemini-2.0-pro'] },
      { name: 'kimi', displayName: 'Moonshot Kimi', available: availableNames.includes('kimi'), manuallyConfigured: hasManual('kimi'), source: hasManual('kimi') && !discovered.kimiApiKey ? 'manual config' : (discovered.kimiApiKey ? detectSource(discovered, 'kimiApiKey') : null), models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0711-preview'] },
      { name: 'glm', displayName: 'Zhipu GLM', available: availableNames.includes('glm'), manuallyConfigured: hasManual('glm'), source: hasManual('glm') && !discovered.glmApiKey ? 'manual config' : (discovered.glmApiKey ? detectSource(discovered, 'glmApiKey') : null), models: ['glm-4-flash', 'glm-4-plus', 'glm-4.5'] },
      { name: 'minmax', displayName: 'MiniMax', available: availableNames.includes('minmax'), manuallyConfigured: hasManual('minmax'), source: hasManual('minmax') && !discovered.minmaxApiKey ? 'manual config' : (discovered.minmaxApiKey ? detectSource(discovered, 'minmaxApiKey') : null), models: ['MiniMax-Text-01', 'MiniMax-M1'] },
      { name: 'qoder', displayName: 'Qwen Qoder', available: availableNames.includes('qoder'), manuallyConfigured: hasManual('qoder'), source: hasManual('qoder') && !discovered.qoderApiKey ? 'manual config' : (discovered.qoderApiKey ? detectSource(discovered, 'qoderApiKey') : null), models: ['qwen-plus', 'qwen-max', 'qwen-coder-plus'] },
      { name: 'ollama', displayName: 'Ollama (Local)', available: availableNames.includes('ollama'), manuallyConfigured: hasManual('ollama'), source: hasManual('ollama') ? (manualConfigs.ollama.baseURL || 'localhost:11434') : (availableNames.includes('ollama') ? 'localhost:11434' : null), models: ['llama3', 'qwen', 'deepseek-coder', 'mistral'], isLocal: true },
      { name: 'compatible', displayName: 'OpenAI Compatible', available: availableNames.includes('compatible'), manuallyConfigured: hasManual('compatible'), source: hasManual('compatible') ? (manualConfigs.compatible.baseURL || 'manual config') : (discovered.compatibleBaseURL || null), models: [] },
    ];

    return { providers, recommended: availableNames[0] || null, savedConfig, manualConfigs, hasAwsBedrock: !!discovered.awsAvailable, hasGcp: !!discovered.gcpAvailable };
  }

  // All known providers — used as fallback when discovery fails
  const ALL_PROVIDERS = [
    { name: 'claude', displayName: 'Anthropic Claude', available: false, manuallyConfigured: false, source: null, models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'] },
    { name: 'openai', displayName: 'OpenAI', available: false, manuallyConfigured: false, source: null, models: ['gpt-4o', 'gpt-4o-mini', 'o1'] },
    { name: 'gemini', displayName: 'Google Gemini', available: false, manuallyConfigured: false, source: null, models: ['gemini-2.0-flash', 'gemini-2.0-pro'] },
    { name: 'kimi', displayName: 'Moonshot Kimi', available: false, manuallyConfigured: false, source: null, models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0711-preview'] },
    { name: 'glm', displayName: 'Zhipu GLM', available: false, manuallyConfigured: false, source: null, models: ['glm-4-flash', 'glm-4-plus', 'glm-4.5'] },
    { name: 'minmax', displayName: 'MiniMax', available: false, manuallyConfigured: false, source: null, models: ['MiniMax-Text-01', 'MiniMax-M1'] },
    { name: 'qoder', displayName: 'Qwen Qoder', available: false, manuallyConfigured: false, source: null, models: ['qwen-plus', 'qwen-max', 'qwen-coder-plus'] },
    { name: 'ollama', displayName: 'Ollama (Local)', available: false, manuallyConfigured: false, source: null, models: ['llama3', 'qwen', 'deepseek-coder', 'mistral'], isLocal: true },
    { name: 'compatible', displayName: 'OpenAI Compatible', available: false, manuallyConfigured: false, source: null, models: [] },
  ];

  // Kick off discovery at startup
  discoveryPromise = runProviderDiscovery()
    .then(result => { discoveryCache = result; console.log(chalk.gray(`  Provider discovery: ${result.providers.filter(p => p.available).length} provider(s) found`)); })
    .catch(err => {
      console.log(chalk.gray(`  Provider discovery: failed (${err.message})`));
      discoveryCache = { providers: ALL_PROVIDERS, recommended: null, savedConfig: {}, manualConfigs: {}, hasAwsBedrock: false, hasGcp: false };
    });

  // Mount sessions router (supports list, detail, and messages endpoints)
  const sessionsRouter = (await import('../../server/routes/sessions.js')).default;
  app.use('/api/sessions', sessionsRouter);
  const pluginsRouter = (await import('../../server/routes/plugins.js')).default;
  app.use('/api/plugins', pluginsRouter);

  // API routes
  app.get('/api/stats', (req, res) => {
    try {
      const days = parseInt(req.query.days, 10) || 7;
      const agent = req.query.agent === 'all' ? undefined : req.query.agent;
      const daily = storage.getDailySummary(days, agent);
      const latestBatch = storage.getLatestBatch();
      res.json({ daily, latestBatch });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analysis', async (req, res) => {
    try {
      const days = parseInt(req.query.days, 10) || 7;
      const end = Date.now();
      const start = end - days * 24 * 60 * 60 * 1000;
      const events = storage.queryByDateRange(start, end);
      const analysis = await ruleEngine.analyze(events);
      res.json(analysis);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Config discovery — return cached results (scanned at startup)
  // ?refresh=true to force a re-scan
  app.get('/api/config/discover', async (req, res) => {
    try {
      if (req.query.refresh === 'true') {
        discoveryCache = null;
        discoveryPromise = runProviderDiscovery()
          .then(result => { discoveryCache = result; })
          .catch(() => {});
      }
      // If startup scan is still running, wait for it
      if (!discoveryCache && discoveryPromise) {
        await discoveryPromise;
      }
      res.json(discoveryCache || { providers: ALL_PROVIDERS, recommended: null, savedConfig: {}, manualConfigs: {}, hasAwsBedrock: false, hasGcp: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save settings
  app.put('/api/settings', async (req, res) => {
    try {
      const { mkdirSync, writeFileSync } = await import('fs');
      const { join: pathJoin } = await import('path');
      const { homedir: getHome } = await import('os');
      const configDir = pathJoin(getHome(), '.aidog');
      mkdirSync(configDir, { recursive: true });
      const cfgPath = pathJoin(configDir, 'config.json');
      writeFileSync(cfgPath, JSON.stringify(req.body, null, 2));

      // Hot-reload security rule overrides if changed
      const securityEngine = req.app.get('securityEngine');
      if (securityEngine && (req.body.securityCountry || req.body.securityRuleOverrides)) {
        const { getCountryDefaults } = await import('../../security/leakage/rules/country-defaults.js');
        if (req.body.securityRuleOverrides) {
          securityEngine.leakageScanner.applyRuleOverrides(req.body.securityRuleOverrides);
        } else if (req.body.securityCountry) {
          const defaults = getCountryDefaults(req.body.securityCountry);
          if (defaults) {
            securityEngine.leakageScanner.applyRuleOverrides({
              S1: defaults.phone,
              S2: defaults.idCard,
            });
          }
        }
      }

      res.json({ status: 'saved' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Read settings
  app.get('/api/settings', async (req, res) => {
    try {
      const { readFileSync } = await import('fs');
      const { join: pathJoin } = await import('path');
      const { homedir: getHome } = await import('os');
      const cfgPath = pathJoin(getHome(), '.aidog', 'config.json');
      const config = JSON.parse(readFileSync(cfgPath, 'utf-8'));
      res.json(config);
    } catch {
      res.json({});
    }
  });

  app.get('/api/analysis/summary', (req, res) => {
    try {
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
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/analyze/trigger', async (req, res) => {
    try {
      const end = Date.now();
      const start = end - 7 * 24 * 60 * 60 * 1000;
      const events = storage.queryByDateRange(start, end);
      const analysis = await ruleEngine.analyze(events);
      storage.saveAnalysisBatch(analysis);
      res.json({ status: 'completed', analysis });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Security module ---
  try {
    const { SecurityEngine } = await import('../../security/index.js');
    const securityEngine = new SecurityEngine({ storage, pluginRegistry: registry });

    // Apply country-based rule overrides from config
    try {
      const { readFileSync: readCfg } = await import('fs');
      const { join: cfgJoin } = await import('path');
      const { homedir: cfgHome } = await import('os');
      const cfgPath = cfgJoin(cfgHome(), '.aidog', 'config.json');
      const cfg = JSON.parse(readCfg(cfgPath, 'utf-8'));
      const { getCountryDefaults } = await import('../../security/leakage/rules/country-defaults.js');

      if (cfg.securityRuleOverrides) {
        securityEngine.leakageScanner.applyRuleOverrides(cfg.securityRuleOverrides);
      } else if (cfg.securityCountry && cfg.securityCountry !== 'CN') {
        const defaults = getCountryDefaults(cfg.securityCountry);
        if (defaults) {
          securityEngine.leakageScanner.applyRuleOverrides({
            S1: defaults.phone,
            S2: defaults.idCard,
          });
        }
      }
    } catch { /* no config or invalid, keep CN defaults */ }

    app.set('securityEngine', securityEngine);
    const securityRouter = (await import('../../server/routes/security.js')).default;
    app.use('/api/security', securityRouter);
    console.log(chalk.gray('  Security module: loaded'));
  } catch (err) {
    console.log(chalk.gray(`  Security module: skipped (${err.message})`));
  }

  // --- Performance module ---
  try {
    const { PerformanceEngine } = await import('../../performance/index.js');
    const performanceEngine = new PerformanceEngine({ storage });
    app.set('performanceEngine', performanceEngine);
    const performanceRouter = (await import('../../server/routes/performance.js')).default;
    app.use('/api/performance', performanceRouter);
    console.log(chalk.gray('  Performance module: loaded'));
  } catch (err) {
    console.log(chalk.gray(`  Performance module: skipped (${err.message})`));
  }

  // --- AI / Optimize module ---
  try {
    const { AIManager } = await import('../../ai/index.js');
    const aiManager = new AIManager();
    app.set('aiManager', aiManager);
    const { aiRouter, applyRouter } = await import('../../server/routes/optimize.js');
    app.use('/api/analyze', aiRouter);
    app.use('/api/apply', applyRouter);
    console.log(chalk.gray('  AI/Optimize module: loaded'));
  } catch (err) {
    console.log(chalk.gray(`  AI/Optimize module: skipped (${err.message})`));
  }

  // --- Rules module ---
  try {
    const { RuleManager } = await import('../../rules/rule-manager.js');
    const ruleManager = new RuleManager({ storage, ruleEngine, securityEngine: app.get('securityEngine') });
    ruleManager.loadAndSync();
    app.set('ruleManager', ruleManager);
    const rulesRouter = (await import('../../server/routes/rules.js')).default;
    app.use('/api/rules', rulesRouter);
  } catch (err) {
    console.log(chalk.gray(`  Rules module: skipped (${err.message})`));
  }

  // SSE endpoint for real-time events
  app.get('/api/watch/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    res.write('data: {"type":"connected"}\n\n');

    const interval = setInterval(() => {
      res.write(':\n\n'); // keepalive
    }, 30000);

    req.on('close', () => {
      clearInterval(interval);
    });
  });

  // Serve saved images from ~/.aidog/images/
  {
    const { join: imgJoin } = await import('path');
    const { homedir: imgHome } = await import('os');
    const { existsSync: imgExists, createReadStream: imgStream } = await import('fs');
    const imagesDir = imgJoin(imgHome(), '.aidog', 'images');
    const imagesPrefix = '/api/images/';
    app.use((req, res, next) => {
      if (!req.path.startsWith(imagesPrefix)) return next();
      const fileName = decodeURIComponent(req.path.slice(imagesPrefix.length));
      if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return next();
      }
      const filePath = imgJoin(imagesDir, fileName);
      if (!imgExists(filePath)) return next();
      const ext = fileName.split('.').pop()?.toLowerCase();
      const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      imgStream(filePath).pipe(res);
    });
  }

  // Serve static files for the web dashboard
  try {
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const distPath = join(__dirname, '..', '..', 'web', 'dist');

    app.use(express.static(distPath));

    // 404 for unmatched API routes (prevent connection hanging)
    app.use('/api', (req, res) => {
      res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
    });

    // SPA fallback for non-API routes
    app.get('*', (req, res) => {
      res.sendFile(join(distPath, 'index.html'));
    });
  } catch {
    app.get('/', (req, res) => {
      res.send('<h1>aidog Dashboard</h1><p>Web UI not built. Run: npm run build:web</p>');
    });
  }

  spinner.succeed('Modules loaded');

  // Initial sync: load historical data from all available plugins
  const availablePlugins = await registry.getAvailable();
  if (availablePlugins.length > 0) {
    const syncSpinner = ora('Syncing historical data...').start();
    let totalSynced = 0;
    for (const plugin of availablePlugins) {
      try {
        const lastSyncKey = `last_sync_${plugin.meta.name}`;
        const lastSync = storage.getSyncMeta(lastSyncKey);
        const since = lastSync ? new Date(parseInt(lastSync, 10)) : undefined;
        const events = await plugin.fetchHistory(since);
        if (events.length > 0) {
          storage.ingestEvents(events);
          totalSynced += events.length;
        }
        // Only advance the sync cursor after a successful fetch + ingest cycle.
        storage.setSyncMeta(lastSyncKey, String(Date.now()));
      } catch {
        // Skip plugins that fail to sync
      }
    }
    syncSpinner.succeed(`Historical sync complete (${totalSynced} new events from ${availablePlugins.length} agent(s))`);
  }

  // Start file watcher
  let watcherCleanups = [];
  if (enableWatch) {
    const watchSpinner = ora('Starting file watchers...').start();

    for (const plugin of availablePlugins) {
      try {
        const unsubscribe = plugin.watch((events) => {
          const eventList = Array.isArray(events) ? events : [events];
          try {
            storage.ingestEvents(eventList);
          } catch {
            // Silently continue
          }
        });
        watcherCleanups.push(unsubscribe);
      } catch {
        // Skip plugins that fail to watch
      }
    }

    watchSpinner.succeed(`File watchers started (${availablePlugins.length} agent(s))`);
  }

  // Start analysis scheduler
  let analysisTimer = null;
  if (analyzeInterval > 0) {
    const intervalMs = analyzeInterval * 60 * 1000;

    const runScheduledAnalysis = async () => {
      try {
        const end = Date.now();
        const start = end - 7 * 24 * 60 * 60 * 1000;
        const events = storage.queryByDateRange(start, end);
        if (events.length > 0) {
          const analysis = await ruleEngine.analyze(events);
          storage.saveAnalysisBatch(analysis);
        }
      } catch {
        // Silently continue on analysis errors
      }
    };

    // Run immediately, then on interval
    runScheduledAnalysis();
    analysisTimer = setInterval(runScheduledAnalysis, intervalMs);

    console.log(chalk.gray(`  Analysis scheduler: every ${analyzeInterval} minute(s)`));
  }

  // Start server
  const server = app.listen(port, () => {
    console.log('');
    console.log(chalk.green.bold(`  ✅ aidog Dashboard is running`));
    console.log('');
    console.log(`  ${chalk.cyan('Local:')}   http://localhost:${port}`);
    console.log(`  ${chalk.gray('API:')}     http://localhost:${port}/api/stats`);
    console.log('');
    console.log(chalk.gray('  Press Ctrl+C to stop\n'));
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal = 'SIGINT') => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(chalk.gray(`\n\nShutting down (${signal})...`));

    if (analysisTimer) {
      clearInterval(analysisTimer);
      analysisTimer = null;
    }

    const forceExitTimer = setTimeout(() => {
      console.error(chalk.yellow('  Shutdown timed out, forcing exit.'));
      process.exit(1);
    }, 5000);

    try {
      await Promise.allSettled(
        watcherCleanups.map(async (unsub) => {
          if (typeof unsub !== 'function') return;
          await unsub();
        })
      );

      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }

      await new Promise((resolve) => server.close(resolve));
      storage.close();
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (err) {
      clearTimeout(forceExitTimer);
      console.error(chalk.red(`  Shutdown failed: ${err.message}`));
      try { storage.close(); } catch { /* ignore */ }
      process.exit(1);
    }
  };

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
}

/**
 * Detect the source of a discovered config key.
 */
function detectSource(discovered, key) {
  // Simple heuristic: env vars are detected first, then Claude Code, then Aider
  if (key === 'anthropicApiKey' && process.env.ANTHROPIC_API_KEY) return 'env: ANTHROPIC_API_KEY';
  if (key === 'openaiApiKey' && process.env.OPENAI_API_KEY) return 'env: OPENAI_API_KEY';
  if (key === 'geminiApiKey' && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) return 'env: GEMINI_API_KEY';
  if (key === 'kimiApiKey' && (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY)) return 'env: KIMI_API_KEY';
  if (key === 'glmApiKey' && (process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY)) return 'env: GLM_API_KEY';
  if (key === 'minmaxApiKey' && (process.env.MINMAX_API_KEY || process.env.MINIMAX_API_KEY)) return 'env: MINMAX_API_KEY';
  if (key === 'qoderApiKey' && (process.env.QODER_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY)) return 'env: QODER_API_KEY';
  // Fallback: assume Claude Code or config file
  if (key === 'anthropicApiKey') return '~/.claude/settings.json';
  if (key === 'openaiApiKey') return 'config file';
  return 'auto-detected';
}
