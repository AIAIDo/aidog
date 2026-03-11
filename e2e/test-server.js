/**
 * Lightweight test server that serves the built frontend + mock API routes.
 * Used by Playwright for e2e testing.
 */
import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Static files
const staticDir = join(__dirname, '..', 'src', 'web', 'dist');
app.use(express.static(staticDir));

// ---- Mock Data ----

const mockSessions = Array.from({ length: 5 }, (_, i) => ({
  sessionId: `test-session-${i + 1}`,
  agent: i % 2 === 0 ? 'claude-code' : 'codex',
  projectName: `project-${i + 1}`,
  projectPath: `/home/user/project-${i + 1}`,
  startTime: Date.now() - (i + 1) * 3600_000,
  endTime: Date.now() - i * 3600_000,
  eventCount: 10 + i * 5,
  totalTokens: 50000 + i * 20000,
  totalInput: 30000 + i * 10000,
  totalOutput: 20000 + i * 10000,
  totalCacheRead: 5000 + i * 1000,
  totalCacheWrite: 1000 + i * 500,
  models: ['claude-sonnet-4-20250514'],
}));

const mockDailySummary = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (6 - i));
  return {
    date: d.toISOString().slice(0, 10),
    sessionCount: 3 + i,
    totalInput: 10000 + i * 5000,
    totalOutput: 8000 + i * 3000,
    totalCacheRead: 2000 + i * 500,
    totalCacheWrite: 500 + i * 200,
  };
});

const mockRules = [
  {
    ruleId: 'R1',
    id: 'R1',
    name: 'Redundant Context',
    severity: 'high',
    description: 'Detects repeated context blocks across turns',
    occurrences: 23,
    estimatedWaste: 45000,
    enabled: true,
    builtIn: true,
    type: 'token',
    sessions: [{ sessionId: 'test-session-1', agent: 'claude-code', waste: 12000 }],
  },
  {
    ruleId: 'R2',
    id: 'R2',
    name: 'Tool Loop Detection',
    severity: 'medium',
    description: 'Identifies repeated tool call patterns',
    occurrences: 12,
    estimatedWaste: 22000,
    enabled: true,
    builtIn: true,
    type: 'token',
    sessions: [],
  },
  {
    ruleId: 'R3',
    id: 'R3',
    name: 'Verbose Output',
    severity: 'low',
    description: 'Checks for unnecessarily verbose responses',
    occurrences: 5,
    estimatedWaste: 3500,
    enabled: false,
    builtIn: true,
    type: 'token',
    sessions: [],
  },
];

const mockSecurityRules = [
  {
    ruleId: 'SEC1',
    id: 'SEC1',
    name: 'API Key Detection',
    severity: 'critical',
    description: 'Scans for exposed API keys',
    enabled: true,
    builtIn: true,
    type: 'security',
  },
  {
    ruleId: 'SEC2',
    id: 'SEC2',
    name: 'Password Pattern',
    severity: 'high',
    description: 'Detects hardcoded passwords',
    enabled: true,
    builtIn: true,
    type: 'security',
  },
];

// ---- Mock API Routes ----

// Stats
app.get('/api/stats', (req, res) => {
  const daily = mockDailySummary;
  const totalInput = daily.reduce((s, d) => s + d.totalInput, 0);
  const totalOutput = daily.reduce((s, d) => s + d.totalOutput, 0);
  res.json({
    totalTokens: totalInput + totalOutput,
    totalInput,
    totalOutput,
    totalCacheRead: daily.reduce((s, d) => s + d.totalCacheRead, 0),
    totalCacheWrite: daily.reduce((s, d) => s + d.totalCacheWrite, 0),
    estimatedCost: 1.23,
    sessions: daily.reduce((s, d) => s + d.sessionCount, 0),
    daily,
    healthScore: {
      score: 72,
      grade: 'B',
      label: 'Good',
      breakdown: {
        wasteRatio: 28,
        cacheEfficiency: 14,
        sessionHygiene: 12,
        modelFit: 10,
        toolEfficiency: 8,
      },
    },
    modelDistribution: {
      'claude-sonnet-4-20250514': { count: 30, tokens: 150000 },
      'claude-haiku-3.5': { count: 10, tokens: 30000 },
    },
  });
});

// Sessions
app.get('/api/sessions', (req, res) => {
  const search = (req.query.search || '').toLowerCase();
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  let filtered = mockSessions;
  if (search) {
    filtered = mockSessions.filter(s =>
      s.sessionId.includes(search) || s.agent.includes(search) || s.projectName.includes(search)
    );
  }

  res.json({
    total: filtered.length,
    limit,
    offset,
    sessions: filtered.slice(offset, offset + limit),
  });
});

app.get('/api/sessions/:id', (req, res) => {
  const session = mockSessions.find(s => s.sessionId === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ ...session, events: [] });
});

app.get('/api/sessions/:id/messages', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;

  const messages = Array.from({ length: 3 }, (_, i) => ({
    id: `msg-${i + 1}`,
    sessionId: req.params.id,
    role: i % 2 === 0 ? 'assistant' : 'user',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000 + i * 500,
    outputTokens: 800 + i * 300,
    cacheRead: 200,
    cacheWrite: 100,
    timestamp: Date.now() - (3 - i) * 60000,
    contentPreview: `Test message content ${i + 1}`,
    toolCalls: i === 0 ? [{ name: 'Read', success: true }] : [],
  }));

  res.json({
    messages,
    pagination: { page, pageSize, total: messages.length, totalPages: 1 },
  });
});

app.get('/api/sessions/messages/:msgId', (req, res) => {
  res.json({
    id: req.params.msgId,
    sessionId: 'test-session-1',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1500,
    outputTokens: 1200,
    timestamp: Date.now(),
    content: [{ type: 'text', text: 'Full message content for testing' }],
  });
});

// Analysis
app.get('/api/analysis/summary', (req, res) => {
  res.json({
    rules: mockRules,
    batch: {
      totalTokens: 200000,
      totalWasted: mockRules.reduce((sum, rule) => sum + (rule.estimatedWaste || 0), 0),
      createdAt: Date.now() - 60000,
    },
  });
});

app.get('/api/analysis', (req, res) => {
  res.json({
    healthScore: {
      score: 72,
      grade: 'B',
      label: 'Good',
      breakdown: {
        wasteRatio: 28,
        cacheEfficiency: 14,
        sessionHygiene: 12,
        modelFit: 10,
        toolEfficiency: 8,
      },
    },
    totalTokens: 200000,
    totalWastedTokens: 70500,
    summary: [
      { rule: 'Redundant Context', ruleId: 'R1', severity: 'high', estimatedWastedTokens: 45000, detail: { description: 'Repeated context blocks' } },
      { rule: 'Tool Loops', ruleId: 'R2', severity: 'medium', estimatedWastedTokens: 22000, detail: { description: 'Repeated tool calls' } },
    ],
  });
});

app.get('/api/analysis/:id/evidence', (req, res) => {
  res.json({ evidence: [] });
});

app.get('/api/analysis/rule/:ruleId/sessions', (req, res) => {
  res.json({ sessions: [] });
});

app.post('/api/analyze/trigger', (req, res) => {
  res.json({ status: 'triggered' });
});

app.get('/api/analyze/schedule', (req, res) => {
  res.json({ running: false, intervalMs: 300000, lastRun: Date.now() - 60000 });
});

// Rules
app.get('/api/rules', (req, res) => {
  const type = req.query.type;
  let rules;
  if (type === 'security') {
    rules = mockSecurityRules;
  } else if (type === 'token') {
    rules = mockRules;
  } else {
    rules = [...mockRules, ...mockSecurityRules];
  }
  res.json({ rules, totalBuiltIn: rules.filter(r => r.builtIn).length, totalCustom: rules.filter(r => !r.builtIn).length });
});

app.get('/api/rules/:id', (req, res) => {
  const rule = [...mockRules, ...mockSecurityRules].find(r => r.ruleId === req.params.id || r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json(rule);
});

app.put('/api/rules/:id/toggle', (req, res) => {
  res.json({ ok: true, ruleId: req.params.id, enabled: req.body.enabled });
});

app.post('/api/rules/custom', (req, res) => {
  res.status(201).json({ ok: true, id: 'custom-new-1' });
});

app.put('/api/rules/custom/:id', (req, res) => {
  res.json({ ok: true });
});

app.delete('/api/rules/custom/:id', (req, res) => {
  res.json({ ok: true });
});

// Plugins
app.get('/api/plugins', (req, res) => {
  res.json({
    plugins: [
      { id: 'claude-code', name: 'Claude Code', description: 'Parse Claude Code JSONL logs', version: '1.0.0', author: 'aidog', available: true, enabled: true },
      { id: 'codex', name: 'Codex CLI', description: 'Parse Codex CLI logs', version: '1.0.0', author: 'aidog', available: true, enabled: false },
      { id: 'custom-plugin', name: 'Custom Plugin', description: 'A test custom plugin', version: '0.1.0', author: 'community', available: false, enabled: false },
    ],
  });
});

app.post('/api/plugins/toggle', (req, res) => {
  res.json({ ok: true });
});

// Config/Settings
app.get('/api/config/discover', (req, res) => {
  res.json({
    recommended: 'anthropic',
    hasAwsBedrock: false,
    providers: [
      { name: 'anthropic', displayName: 'Anthropic', available: true, source: 'env', isLocal: false, models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'] },
      { name: 'ollama', displayName: 'Ollama', available: false, source: null, isLocal: true, models: [] },
    ],
  });
});

app.get('/api/settings', (req, res) => {
  res.json({
    aiProvider: 'auto',
    aiModel: 'claude-sonnet-4-20250514',
    providerConfigs: {},
    alertThreshold: 80,
    dataPath: '~/.aidog/data',
    analysisInterval: 300,
    maxSessionAge: 30,
    autoAnalyze: true,
  });
});

app.put('/api/settings', (req, res) => {
  res.json({ ok: true });
});

// Security
app.post('/api/security/scan/trigger', (req, res) => {
  res.json({
    status: 'completed',
    scanId: 'sec_test001',
    scannedAt: Date.now(),
    leakage: { filesScanned: 128, linesScanned: 15420, totalFindings: 2, findings: [
      { ruleId: 'api-key', ruleName: 'API Key Detection', severity: 'critical', filePath: '/test/.env', line: 3, maskedSnippet: 'API_KEY=sk-***' },
      { ruleId: 'password', ruleName: 'Password Pattern', severity: 'high', filePath: '/test/config.js', line: 15, maskedSnippet: 'password = "***"' },
    ]},
    exposure: { publicIp: '1.2.3.4', portFindings: [], localBindingFindings: [], tunnelFindings: [] },
    securityScore: {
      score: 85,
      grade: 'B',
      label: 'Good',
      breakdown: { leakage: 40, exposure: 45 },
      trend: { direction: 'up', delta: 5, history: [{ date: '2026-03-01', score: 80 }, { date: '2026-03-08', score: 85 }] },
    },
  });
});

app.get('/api/security/scan/latest', (req, res) => {
  res.json({
    scan: {
      id: 1,
      scanId: 'sec_test001',
      scanType: 'full',
      scannedAt: Date.now(),
      filesScanned: 128,
      linesScanned: 15420,
      totalFindings: 2,
      securityScore: {
        score: 85,
        grade: 'B',
        label: 'Good',
        breakdown: { leakage: 40, exposure: 45 },
        trend: { direction: 'up', delta: 5, history: [{ date: '2026-03-01', score: 80 }, { date: '2026-03-08', score: 85 }] },
      },
    },
    findings: [
      { id: 1, ruleId: 'api-key', ruleName: 'API Key Detection', severity: 'critical', category: 'leakage', filePath: '/test/.env', maskedSnippet: 'API_KEY=sk-***' },
    ],
  });
});

app.get('/api/security/findings', (req, res) => {
  const pageSize = parseInt(req.query.pageSize) || 50;
  res.json({
    findings: [
      { id: 1, ruleId: 'api-key', ruleName: 'API Key Detection', severity: 'critical', category: 'leakage', filePath: '/test/.env', maskedSnippet: 'API_KEY=sk-***' },
      { id: 2, ruleId: 'password', ruleName: 'Password Pattern', severity: 'high', category: 'leakage', filePath: '/test/config.js', maskedSnippet: 'password = "***"' },
    ],
    pagination: { page: 1, pageSize, total: 2, totalPages: 1 },
  });
});

app.get('/api/security/rules', (req, res) => {
  res.json({
    rules: mockSecurityRules,
    totalBuiltIn: 2,
    totalCustom: 0,
  });
});

app.get('/api/security/history', (req, res) => {
  res.json({
    history: [],
    trend: 'up',
    trendData: {
      direction: 'up',
      delta: 5,
      history: [{ date: '2026-03-01', score: 80 }, { date: '2026-03-08', score: 85 }],
    },
  });
});

// AI Optimize (streaming)
app.get('/api/analyze/ai/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const chunks = [
    { type: 'chunk', content: '## Optimization Report\n\n' },
    { type: 'chunk', content: '1. **Reduce context duplication** - Priority: High\n' },
    { type: 'chunk', content: '2. **Enable caching** - Priority: Medium\n' },
    { type: 'done' },
  ];

  let i = 0;
  const interval = setInterval(() => {
    if (i >= chunks.length) {
      clearInterval(interval);
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify(chunks[i])}\n\n`);
    i++;
  }, 100);

  req.on('close', () => clearInterval(interval));
});

app.post('/api/analyze/ai', (req, res) => {
  res.json({ result: 'AI analysis complete' });
});

app.post('/api/apply/:fixId', (req, res) => {
  res.json({ ok: true, fixId: req.params.fixId });
});

// SSE events
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  req.on('close', () => {});
});

// Watch
app.get('/api/watch', (req, res) => {
  res.json({ watching: false });
});

// 404 for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(staticDir, 'index.html'), (err) => {
    if (err) {
      res.status(200).json({ message: 'Web UI not built. Run: npm run build:web' });
    }
  });
});

app.listen(PORT, () => {
  console.log(`[test-server] Running at http://localhost:${PORT}`);
});
