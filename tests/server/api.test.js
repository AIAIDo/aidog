import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../src/server/index.js';
import { RuleEngine } from '../../src/rules/engine.js';
import { SQLiteStorage } from '../../src/storage/sqlite.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createMockEvent(overrides = {}) {
  return {
    id: `claude-code:msg_${Math.random().toString(36).slice(2)}`,
    agent: 'claude-code',
    sourceMessageId: `msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'test-session-1',
    projectPath: '/test/project',
    projectName: 'test-project',
    timestamp: Date.now(),
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    cacheRead: 0,
    cacheWrite: 0,
    toolCalls: [],
    contentLength: 100,
    ...overrides,
  };
}

/**
 * Make a request to the Express app without starting a real HTTP server.
 * Uses app.handle() through supertest-like approach with raw http.
 */
async function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://localhost${path}`);

    const req = {
      method,
      url: url.pathname + url.search,
      path: url.pathname,
      headers: { 'content-type': 'application/json' },
      query: Object.fromEntries(url.searchParams),
      params: {},
      body: body || {},
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get(header) { return this.headers[header.toLowerCase()]; },
      on(event, cb) {
        if (event === 'end') cb();
        return this;
      },
    };

    const res = {
      statusCode: 200,
      _headers: {},
      _body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) {
        this._body = data;
        this.statusCode = this.statusCode || 200;
        resolve({ status: this.statusCode, body: data });
      },
      send(data) {
        this._body = data;
        resolve({ status: this.statusCode, body: data });
      },
      sendFile(filePath, cb) {
        if (cb) cb(new Error('File not found'));
        else resolve({ status: 200, body: 'file' });
      },
      setHeader(k, v) { this._headers[k] = v; return this; },
      sendStatus(code) {
        this.statusCode = code;
        resolve({ status: code, body: null });
      },
      flushHeaders() {},
      write() {},
      end() { resolve({ status: this.statusCode, body: this._body }); },
      getHeader(k) { return this._headers[k]; },
    };

    // Use a timeout to catch hanging requests
    const timeout = setTimeout(() => {
      reject(new Error(`Request to ${path} timed out`));
    }, 5000);

    app.handle(req, res, (err) => {
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve({ status: res.statusCode || 404, body: res._body });
    });
  });
}

async function requestStream(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://localhost${path}`);
    const chunks = [];
    let timeout;

    const req = {
      method,
      url: url.pathname + url.search,
      path: url.pathname,
      headers: { 'content-type': 'application/json' },
      query: Object.fromEntries(url.searchParams),
      params: {},
      body: body || {},
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get(header) { return this.headers[header.toLowerCase()]; },
      on(event, cb) {
        if (event === 'end') cb();
        return this;
      },
    };

    const res = {
      statusCode: 200,
      _headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this._headers[k] = v; return this; },
      flushHeaders() {},
      write(data) {
        chunks.push(String(data));
        return true;
      },
      end(data) {
        clearTimeout(timeout);
        if (data) chunks.push(String(data));
        resolve({ status: this.statusCode, body: chunks.join(''), headers: this._headers });
      },
      json(data) {
        clearTimeout(timeout);
        resolve({ status: this.statusCode, body: JSON.stringify(data), headers: this._headers });
      },
      send(data) {
        clearTimeout(timeout);
        resolve({ status: this.statusCode, body: String(data), headers: this._headers });
      },
      getHeader(k) { return this._headers[k]; },
    };

    timeout = setTimeout(() => {
      reject(new Error(`Request to ${path} timed out`));
    }, 5000);

    app.handle(req, res, (err) => {
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve({ status: res.statusCode || 404, body: chunks.join(''), headers: res._headers });
    });
  });
}

describe('Server API', () => {
  let storage;
  let tmpDir;
  let app;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidog-server-test-'));
    storage = new SQLiteStorage(join(tmpDir, 'test.db'));

    const ruleEngine = new RuleEngine();
    const mockRegistry = {
      getAll() {
        return [
          {
            meta: { name: 'claude-code', displayName: 'Claude Code', version: '1.0.0', homepage: 'https://claude.ai' },
            async isAvailable() { return true; },
            _enabled: true,
          },
        ];
      },
      getByName(name) {
        return this.getAll().find((p) => p.meta.name === name);
      },
    };

    const server = createServer({
      storage,
      ruleEngine,
      pluginRegistry: mockRegistry,
      port: 0,
    });
    app = server.app;
  });

  afterEach(() => {
    if (storage) storage.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/stats', () => {
    it('should return proper stats structure', async () => {
      // Seed some data
      storage.ingestEvents([
        createMockEvent({ inputTokens: 1000, outputTokens: 500 }),
        createMockEvent({ inputTokens: 2000, outputTokens: 1000 }),
      ]);

      const res = await request(app, 'GET', '/api/stats?days=7');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalTokens');
      expect(res.body).toHaveProperty('totalInput');
      expect(res.body).toHaveProperty('totalOutput');
      expect(res.body).toHaveProperty('estimatedCost');
      expect(res.body).toHaveProperty('healthScore');
      expect(res.body).toHaveProperty('dailySummary');
    });

    it('should support compact stats payload', async () => {
      storage.ingestEvents([
        createMockEvent({ inputTokens: 1000, outputTokens: 500 }),
      ]);

      const res = await request(app, 'GET', '/api/stats?days=7&compact=1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('dailySummary');
      expect(res.body).not.toHaveProperty('healthScore');
      expect(res.body).not.toHaveProperty('modelDistribution');
    });

    it('should return zero stats when no data exists', async () => {
      const res = await request(app, 'GET', '/api/stats?days=7');
      expect(res.status).toBe(200);
      expect(res.body.totalTokens).toBe(0);
    });
  });

  describe('GET /api/analyze/ai/stream', () => {
    it('should allow CLI adapter to stream AI analysis results', async () => {
      storage.ingestEvents([
        createMockEvent({ inputTokens: 1000, outputTokens: 500, sessionId: 'stream-1' }),
      ]);

      const mockAIManager = {
        async selectAdapter() {
          return { meta: { name: 'cli' } };
        },
        async analyze(_analysisData, options = {}) {
          options.onChunk?.('{"issues":[');
          options.onChunk?.(']}');
          return { issues: [], summary: 'ok' };
        },
      };

      const server = createServer({
        storage,
        ruleEngine: new RuleEngine(),
        pluginRegistry: {
          getAll() { return []; },
          getByName() { return null; },
        },
        aiManager: mockAIManager,
        port: 0,
      });

      const res = await requestStream(server.app, 'GET', '/api/analyze/ai/stream?days=7');

      expect(res.status).toBe(200);
      expect(res.body).toContain('"type":"start"');
      expect(res.body).toContain('"type":"chunk","text":"{\\"issues\\":["');
      expect(res.body).toContain('"type":"chunk","text":"]}"');
      expect(res.body).toContain('"type":"done"');
      expect(res.body).not.toContain('CLI_ONLY');
    });
  });

  describe('GET /api/analysis/summary', () => {
    it('includes session titles for affected sessions', async () => {
      storage.ingestEvents([
        createMockEvent({
          sessionId: 'title-session-1',
          role: 'user',
          content: '请帮我修复 retry loop 问题，并解释原因',
        }),
        createMockEvent({
          sessionId: 'title-session-1',
          role: 'assistant',
        }),
      ]);

      storage.saveAnalysisBatch({
        periodStart: Date.now() - 1000,
        periodEnd: Date.now(),
        totalTokens: 1000,
        totalWastedTokens: 200,
        healthScore: { score: 80, grade: 'B' },
        byRule: {
          R6_retry_loop: [{
            sessionId: 'title-session-1',
            agent: 'claude-code',
            severity: 'HIGH',
            estimatedWastedTokens: 200,
            detail: { retries: 3 },
            evidence: [],
          }],
        },
      });

      const res = await request(app, 'GET', '/api/analysis/summary');

      expect(res.status).toBe(200);
      const retryRule = res.body.rules.find((rule) => rule.id === 'R6_retry_loop');
      expect(retryRule.sessions[0].title).toBeTruthy();
      expect(retryRule.sessions[0].sessionId).toBe('title-session-1');
    });
  });

  describe('GET /api/sessions', () => {
    it('should return sessions list', async () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'sess-1' }),
        createMockEvent({ sessionId: 'sess-2' }),
      ]);

      const res = await request(app, 'GET', '/api/sessions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('sessions');
      expect(res.body).toHaveProperty('total');
      expect(res.body.sessions).toBeInstanceOf(Array);
    });

    it('should return empty list when no sessions', async () => {
      const res = await request(app, 'GET', '/api/sessions');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    });
  });

  describe('GET /api/sessions with search', () => {
    it('should filter sessions by search term', async () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'sess-alpha', agent: 'claude-code', projectName: 'project-a' }),
        createMockEvent({ sessionId: 'sess-beta', agent: 'cursor', projectName: 'project-b' }),
      ]);

      const res = await request(app, 'GET', '/api/sessions?search=alpha');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.sessions[0].sessionId).toBe('sess-alpha');
    });

    it('should search by agent name', async () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'sess-1', agent: 'claude-code' }),
        createMockEvent({ sessionId: 'sess-2', agent: 'cursor' }),
      ]);

      const res = await request(app, 'GET', '/api/sessions?search=cursor');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.sessions[0].agent).toBe('cursor');
    });

    it('should return all sessions with empty search', async () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'sess-1' }),
        createMockEvent({ sessionId: 'sess-2' }),
      ]);

      const res = await request(app, 'GET', '/api/sessions?search=');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
    });
  });

  describe('GET /api/sessions/:id/messages', () => {
    it('should return paginated messages for a session', async () => {
      const events = Array.from({ length: 5 }, (_, i) =>
        createMockEvent({
          sessionId: 'msg-session',
          timestamp: Date.now() + i * 1000,
          role: i % 2 === 0 ? 'user' : 'assistant',
        })
      );
      storage.ingestEvents(events);

      const res = await request(app, 'GET', '/api/sessions/msg-session/messages?page=1&pageSize=3');
      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(3);
      expect(res.body.pagination.total).toBe(5);
      expect(res.body.pagination.totalPages).toBe(2);
    });

    it('should return 404 for nonexistent session', async () => {
      const res = await request(app, 'GET', '/api/sessions/nonexistent/messages');
      expect(res.status).toBe(404);
    });

    it('should support search in messages', async () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'search-msg-sess', role: 'user', model: 'gpt-4' }),
        createMockEvent({ sessionId: 'search-msg-sess', role: 'assistant', model: 'claude-opus' }),
      ]);

      const res = await request(app, 'GET', '/api/sessions/search-msg-sess/messages?search=opus');
      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(1);
    });

    it('should search message content via FTS', async () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'fts-api-sess', content: JSON.stringify('implement authentication flow'), timestamp: Date.now() }),
        createMockEvent({ sessionId: 'fts-api-sess', content: JSON.stringify('fix CSS styles'), timestamp: Date.now() + 1000 }),
      ]);

      const res = await request(app, 'GET', '/api/sessions/fts-api-sess/messages?search=authentication');
      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(1);
    });
  });

  describe('GET /api/sessions with FTS content search', () => {
    it('should find sessions by message content', async () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'fts-sess-1', content: JSON.stringify('refactor database queries') }),
        createMockEvent({ sessionId: 'fts-sess-2', content: JSON.stringify('update README documentation') }),
      ]);

      const res = await request(app, 'GET', '/api/sessions?search=database');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.sessions[0].sessionId).toBe('fts-sess-1');
    });

    it('should return sessions matching both content and metadata', async () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'by-meta', agent: 'target-agent', content: JSON.stringify('unrelated') }),
        createMockEvent({ sessionId: 'by-content', agent: 'other-agent', content: JSON.stringify('target-agent mentioned in text') }),
      ]);

      const res = await request(app, 'GET', '/api/sessions?search=target-agent');
      expect(res.status).toBe(200);
      // Both should match: one by agent metadata, one by content FTS
      expect(res.body.total).toBe(2);
    });
  });

  describe('GET /api/plugins', () => {
    it('should return plugins list', async () => {
      const res = await request(app, 'GET', '/api/plugins');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('plugins');
      expect(res.body.plugins).toBeInstanceOf(Array);
      expect(res.body.plugins[0]).toHaveProperty('name');
      expect(res.body.plugins[0]).toHaveProperty('displayName');
      expect(res.body.plugins[0]).toHaveProperty('available');
    });
  });

  describe('GET /api/performance/overview', () => {
    it('should support compact overview payload for the dashboard page', async () => {
      storage.ingestEvents([
        createMockEvent({
          sessionId: 'perf-1',
          role: 'user',
          content: JSON.stringify('first prompt'),
          toolCalls: [{ type: 'tool_use', name: 'read_file', inputSize: 10, outputSize: 20 }],
        }),
        createMockEvent({
          sessionId: 'perf-1',
          role: 'assistant',
          timestamp: Date.now() + 1000,
          inputTokens: 1200,
          outputTokens: 600,
        }),
        createMockEvent({
          sessionId: 'perf-2',
          role: 'assistant',
          model: 'claude-opus-4-20250514',
          inputTokens: 3000,
          outputTokens: 1200,
        }),
      ]);

      const res = await request(app, 'GET', '/api/performance/overview?days=7&compact=1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metrics');
      expect(res.body).toHaveProperty('score');
      expect(res.body).toHaveProperty('sessionMetrics');
      expect(res.body).not.toHaveProperty('agents');
      expect(res.body).not.toHaveProperty('tools');
      expect(res.body.sessionMetrics.length).toBeLessThanOrEqual(5);
      expect(res.body.sessionMetrics[0]).toHaveProperty('sessionId');
      expect(res.body.sessionMetrics[0]).toHaveProperty('cost');
      expect(res.body.sessionMetrics[0]).not.toHaveProperty('totalInput');
    });
  });

  describe('POST /api/analyze/trigger', () => {
    it('should trigger analysis and return result', async () => {
      storage.ingestEvents([
        createMockEvent({ inputTokens: 1000, outputTokens: 500 }),
      ]);

      const res = await request(app, 'POST', '/api/analyze/trigger');
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Analysis completed');
      expect(res.body).toHaveProperty('healthScore');
      expect(res.body).toHaveProperty('totalTokens');
    });

    it('should return result even with no data', async () => {
      const res = await request(app, 'POST', '/api/analyze/trigger');
      expect(res.status).toBe(200);
    });
  });

  // ===== Session Detail =====

  describe('GET /api/sessions/:id', () => {
    it('should return session detail with aggregated data', async () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'detail-sess', inputTokens: 1000, outputTokens: 500, model: 'claude-sonnet-4-20250514' }),
        createMockEvent({ sessionId: 'detail-sess', inputTokens: 2000, outputTokens: 800, model: 'claude-opus-4-20250514' }),
      ]);

      const res = await request(app, 'GET', '/api/sessions/detail-sess');
      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBe('detail-sess');
      expect(res.body.totalInput).toBe(3000);
      expect(res.body.totalOutput).toBe(1300);
      expect(res.body.totalTokens).toBe(4300);
      expect(res.body.eventCount).toBe(2);
      expect(res.body.models).toContain('claude-sonnet-4-20250514');
      expect(res.body.models).toContain('claude-opus-4-20250514');
      expect(res.body.events).toBeInstanceOf(Array);
      expect(res.body.events).toHaveLength(2);
    });

    it('should return 404 for nonexistent session', async () => {
      const res = await request(app, 'GET', '/api/sessions/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });

    it('should include start and end time', async () => {
      const t1 = Date.now() - 10000;
      const t2 = Date.now();
      storage.ingestEvents([
        createMockEvent({ sessionId: 'time-sess', timestamp: t1 }),
        createMockEvent({ sessionId: 'time-sess', timestamp: t2 }),
      ]);

      const res = await request(app, 'GET', '/api/sessions/time-sess');
      expect(res.status).toBe(200);
      expect(res.body.startTime).toBe(t1);
      expect(res.body.endTime).toBe(t2);
    });
  });

  // ===== Message by ID =====

  describe('GET /api/sessions/messages/:msgId', () => {
    it('should return a single message by ID', async () => {
      const event = createMockEvent({ sessionId: 'msg-id-sess' });
      storage.ingestEvents([event]);

      const res = await request(app, 'GET', `/api/sessions/messages/${event.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(event.id);
      expect(res.body.sessionId).toBe('msg-id-sess');
    });

    it('should return 404 for nonexistent message', async () => {
      const res = await request(app, 'GET', '/api/sessions/messages/nonexistent-msg-id');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });

  // ===== Plugin Enable/Disable =====

  describe('POST /api/plugins/:name/enable', () => {
    it('should enable a plugin', async () => {
      const res = await request(app, 'POST', '/api/plugins/claude-code/enable');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('claude-code');
      expect(res.body.enabled).toBe(true);
    });

    it('should return 404 for unknown plugin', async () => {
      const res = await request(app, 'POST', '/api/plugins/unknown-plugin/enable');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /api/plugins/:name/disable', () => {
    it('should disable a plugin', async () => {
      const res = await request(app, 'POST', '/api/plugins/claude-code/disable');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('claude-code');
      expect(res.body.enabled).toBe(false);
    });

    it('should return 404 for unknown plugin', async () => {
      const res = await request(app, 'POST', '/api/plugins/unknown-plugin/disable');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ===== Analysis =====

  describe('GET /api/analysis', () => {
    it('should return empty when no analysis has been run', async () => {
      const res = await request(app, 'GET', '/api/analysis');
      expect(res.status).toBe(200);
      expect(res.body.batch).toBeNull();
      expect(res.body.results).toEqual([]);
    });

    it('should return latest batch with results after analysis', async () => {
      storage.saveAnalysisBatch({
        periodStart: Date.now() - 2 * 86400000,
        periodEnd: Date.now() - 86400000,
        totalTokens: 4000,
        totalWastedTokens: 500,
        healthScore: { score: 72, grade: 'C' },
        byRule: {},
      });
      storage.saveAnalysisBatch({
        periodStart: Date.now() - 86400000,
        periodEnd: Date.now(),
        totalTokens: 5000,
        totalWastedTokens: 1000,
        healthScore: { score: 80, grade: 'B' },
        byRule: {
          R1: {
            sessionId: 'sess-1',
            agent: 'claude-code',
            severity: 'medium',
            detail: { test: true },
            evidence: [{ eventId: 'e1' }],
            suggestion: 'Fix it',
          },
        },
      });

      const res = await request(app, 'GET', '/api/analysis');
      expect(res.status).toBe(200);
      expect(res.body.healthScore).toBeDefined();
      expect(res.body.healthScore.score).toBe(80);
      expect(res.body.healthScore.previousScore).toBe(72);
      expect(res.body.totalTokens).toBe(5000);
      expect(res.body.totalWastedTokens).toBe(1000);
      expect(res.body.summary).toBeInstanceOf(Array);
      expect(res.body.batch).toBeDefined();
      expect(res.body.batch.totalTokens).toBe(5000);
      expect(res.body.batch.totalWasted).toBe(1000);
      expect(res.body.results).toBeInstanceOf(Array);
      expect(res.body.results.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/analysis/:id/evidence', () => {
    it('should return evidence for a valid analysis result', async () => {
      storage.saveAnalysisBatch({
        periodStart: Date.now() - 86400000,
        periodEnd: Date.now(),
        totalTokens: 5000,
        totalWastedTokens: 1000,
        healthScore: { score: 80, grade: 'B' },
        byRule: {
          R1: {
            sessionId: 'sess-1',
            agent: 'claude-code',
            severity: 'medium',
            detail: { test: true },
            evidence: [{ eventId: 'ev-1' }],
            suggestion: 'Fix it',
          },
        },
      });

      const results = storage.db.prepare('SELECT id FROM analysis_results LIMIT 1').all();
      expect(results.length).toBeGreaterThan(0);
      const resultId = results[0].id;

      const res = await request(app, 'GET', `/api/analysis/${resultId}/evidence`);
      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.evidence).toBeInstanceOf(Array);
      expect(res.body).toHaveProperty('relatedEvents');
    });

    it('should return 404 for nonexistent analysis result', async () => {
      const res = await request(app, 'GET', '/api/analysis/nonexistent-id/evidence');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/analysis/rule/:ruleId/sessions', () => {
    it('should return sessions that triggered a rule', async () => {
      storage.saveAnalysisBatch({
        periodStart: Date.now() - 86400000,
        periodEnd: Date.now(),
        totalTokens: 5000,
        totalWastedTokens: 1000,
        healthScore: { score: 80, grade: 'B' },
        byRule: {
          R1: {
            sessionId: 'sess-r1',
            agent: 'claude-code',
            severity: 'medium',
            detail: { test: true },
            evidence: [],
            suggestion: 'Reduce context',
          },
        },
      });

      const res = await request(app, 'GET', '/api/analysis/rule/R1/sessions');
      expect(res.status).toBe(200);
      expect(res.body.ruleId).toBe('R1');
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.sessions).toBeInstanceOf(Array);
      expect(res.body.sessions[0]).toHaveProperty('sessionId');
    });

    it('should return empty for rule with no triggers', async () => {
      const res = await request(app, 'GET', '/api/analysis/rule/NONEXISTENT/sessions');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.sessions).toEqual([]);
    });
  });

  // ===== Analyze Schedule =====

  describe('GET /api/analyze/schedule', () => {
    it('should return scheduler status', async () => {
      const res = await request(app, 'GET', '/api/analyze/schedule');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('running');
    });
  });

  // ===== Optimize (AI + Apply) =====

  describe('POST /api/analyze/ai', () => {
    it('should return 503 when AI manager is not configured', async () => {
      const res = await request(app, 'POST', '/api/analyze/ai', { days: 7 });
      expect(res.status).toBe(503);
      expect(res.body.error).toContain('AI manager not configured');
    });
  });

  describe('POST /api/apply/:fixId', () => {
    it('should return guidance for mcp-cleanup', async () => {
      const res = await request(app, 'POST', '/api/apply/mcp-cleanup');
      expect(res.status).toBe(200);
      expect(res.body.fixId).toBe('mcp-cleanup');
      expect(res.body.status).toBe('guidance');
      expect(res.body.steps).toBeInstanceOf(Array);
      expect(res.body.steps.length).toBeGreaterThan(0);
    });

    it('should return guidance for cache-hint', async () => {
      const res = await request(app, 'POST', '/api/apply/cache-hint', { config: { test: true } });
      expect(res.status).toBe(200);
      expect(res.body.fixId).toBe('cache-hint');
      expect(res.body.status).toBe('guidance');
      expect(res.body.steps).toBeInstanceOf(Array);
    });

    it('should return 404 for unknown fix', async () => {
      const res = await request(app, 'POST', '/api/apply/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Unknown fix');
    });
  });

  // ===== Rules =====

  describe('GET /api/rules', () => {
    it('should return all rules with counts', async () => {
      const res = await request(app, 'GET', '/api/rules');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rules');
      expect(res.body).toHaveProperty('counts');
      expect(res.body.rules).toBeInstanceOf(Array);
      expect(res.body.rules.length).toBeGreaterThan(0);
      expect(res.body.rules.length).toBeLessThanOrEqual(res.body.counts.total);
    });

    it('should filter by type=token', async () => {
      const res = await request(app, 'GET', '/api/rules?type=token');
      expect(res.status).toBe(200);
      expect(res.body.rules.every(r => r.type === 'token')).toBe(true);
    });

    it('should filter by type=security', async () => {
      const res = await request(app, 'GET', '/api/rules?type=security');
      expect(res.status).toBe(200);
      expect(res.body.rules.every(r => r.type === 'security')).toBe(true);
    });

    it('should default phone, id-card, and bank-card security rules to disabled', async () => {
      const res = await request(app, 'GET', '/api/rules?type=security');
      expect(res.status).toBe(200);

      const byId = new Map(res.body.rules.map(rule => [rule.id, rule]));
      expect(byId.get('S1')?.enabled).toBe(false);
      expect(byId.get('S2')?.enabled).toBe(false);
      expect(byId.get('S3')?.enabled).toBe(false);
    });

    it('should include expected rule fields', async () => {
      const res = await request(app, 'GET', '/api/rules');
      const rule = res.body.rules[0];
      expect(rule).toHaveProperty('id');
      expect(rule).toHaveProperty('name');
      expect(rule).toHaveProperty('type');
      expect(rule).toHaveProperty('severity');
      expect(rule).toHaveProperty('builtIn');
      expect(rule).toHaveProperty('enabled');
    });
  });

  describe('GET /api/rules/:id', () => {
    it('should return a specific rule by ID', async () => {
      const allRes = await request(app, 'GET', '/api/rules');
      const firstRule = allRes.body.rules[0];

      const res = await request(app, 'GET', `/api/rules/${firstRule.id}?type=${firstRule.type}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(firstRule.id);
    });

    it('should return 404 for nonexistent rule', async () => {
      const res = await request(app, 'GET', '/api/rules/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/rules/:id/toggle', () => {
    it('should toggle a rule enabled state', async () => {
      const allRes = await request(app, 'GET', '/api/rules?type=token');
      const firstRule = allRes.body.rules[0];

      const res = await request(app, 'PUT', `/api/rules/${firstRule.id}/toggle`, {
        enabled: false,
        type: 'token',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.enabled).toBe(false);
    });

    it('should allow enabling a security rule that is disabled by default', async () => {
      const res = await request(app, 'PUT', '/api/rules/S1/toggle', {
        enabled: true,
        type: 'security',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.enabled).toBe(true);

      const listRes = await request(app, 'GET', '/api/rules?type=security');
      const rule = listRes.body.rules.find(r => r.id === 'S1');
      expect(rule?.enabled).toBe(true);
    });

    it('should update a built-in security rule override', async () => {
      const res = await request(app, 'PUT', '/api/rules/S1', {
        type: 'security',
        name: '手机号-自定义',
        severity: 'high',
        description: '检测手机号或显式标记',
        definition: {
          matchType: 'literal',
          patterns: ['PHONE_SECRET'],
          mask: { prefix: 2, suffix: 2 },
          category: 'leakage',
        },
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const listRes = await request(app, 'GET', '/api/rules?type=security');
      const rule = listRes.body.rules.find(r => r.id === 'S1');
      expect(rule).toMatchObject({
        id: 'S1',
        name: '手机号-自定义',
        severity: 'high',
        description: '检测手机号或显式标记',
        hasOverride: true,
      });
      expect(rule.definition).toMatchObject({
        matchType: 'literal',
        patterns: ['PHONE_SECRET'],
        mask: { prefix: 2, suffix: 2 },
      });
    });

    it('should restore a built-in security rule to defaults', async () => {
      await request(app, 'PUT', '/api/rules/S1', {
        type: 'security',
        name: '手机号-自定义',
        severity: 'high',
        description: '检测手机号或显式标记',
        definition: {
          matchType: 'literal',
          patterns: ['PHONE_SECRET'],
          mask: { prefix: 2, suffix: 2 },
          category: 'leakage',
        },
      });

      const restoreRes = await request(app, 'DELETE', '/api/rules/S1/override?type=security');
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.restored).toBe(true);

      const listRes = await request(app, 'GET', '/api/rules?type=security');
      const rule = listRes.body.rules.find(r => r.id === 'S1');
      expect(rule?.name).toBe('手机号');
      expect(rule?.severity).toBe('medium');
      expect(rule?.hasOverride).toBe(false);
      expect(rule?.definition?.matchType).toBe('regex');
      expect(rule?.definition?.patterns?.[0]).toContain('1[3-9]');
    });

    it('should reject invalid enabled value', async () => {
      const res = await request(app, 'PUT', '/api/rules/R1/toggle', {
        enabled: 'not-boolean',
        type: 'token',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('enabled must be a boolean');
    });

    it('should reject invalid type', async () => {
      const res = await request(app, 'PUT', '/api/rules/R1/toggle', {
        enabled: true,
        type: 'invalid',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('type must be');
    });
  });

  describe('POST /api/rules/custom', () => {
    it('should create a custom token rule', async () => {
      const res = await request(app, 'POST', '/api/rules/custom', {
        ruleType: 'token',
        name: 'Test Custom Rule',
        severity: 'medium',
        description: 'A test custom rule',
        definition: {
          field: 'inputTokens',
          aggregation: 'max',
          operator: '>',
          threshold: 50000,
        },
      });
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    it('should create a custom security rule', async () => {
      const res = await request(app, 'POST', '/api/rules/custom', {
        ruleType: 'security',
        name: 'Test Security Rule',
        severity: 'high',
        description: 'Detect test patterns',
        definition: {
          patterns: ['TEST_SECRET_[A-Z0-9]{10}'],
        },
      });
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
    });

    it('should create a custom literal security rule', async () => {
      const res = await request(app, 'POST', '/api/rules/custom', {
        ruleType: 'security',
        name: 'Literal Secret',
        severity: 'medium',
        description: 'Detect literal secrets',
        definition: {
          matchType: 'literal',
          patterns: ['HARDCODED_SECRET'],
          mask: { prefix: 3, suffix: 2 },
        },
      });
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);

      const listRes = await request(app, 'GET', '/api/rules?type=security');
      const created = listRes.body.rules.find(r => r.name === 'Literal Secret');
      expect(created?.definition).toMatchObject({
        matchType: 'literal',
        patterns: ['HARDCODED_SECRET'],
        mask: { prefix: 3, suffix: 2 },
      });
    });

    it('should reject invalid ruleType', async () => {
      const res = await request(app, 'POST', '/api/rules/custom', {
        ruleType: 'invalid',
        name: 'Bad Rule',
        severity: 'medium',
        definition: {},
      });
      expect(res.status).toBe(400);
    });

    it('should reject missing name', async () => {
      const res = await request(app, 'POST', '/api/rules/custom', {
        ruleType: 'token',
        severity: 'medium',
        definition: { field: 'inputTokens', aggregation: 'max', operator: '>', threshold: 100 },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/rules/custom/:id', () => {
    it('should update an existing custom rule', async () => {
      const createRes = await request(app, 'POST', '/api/rules/custom', {
        ruleType: 'token',
        name: 'Rule To Update',
        severity: 'low',
        definition: { field: 'inputTokens', aggregation: 'sum', operator: '>', threshold: 100 },
      });
      const ruleId = createRes.body.id;

      const res = await request(app, 'PUT', `/api/rules/custom/${ruleId}`, {
        name: 'Updated Rule Name',
        severity: 'high',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should return 404 for nonexistent custom rule', async () => {
      const res = await request(app, 'PUT', '/api/rules/custom/nonexistent', {
        name: 'Updated',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/rules/custom/:id', () => {
    it('should delete an existing custom rule', async () => {
      const createRes = await request(app, 'POST', '/api/rules/custom', {
        ruleType: 'token',
        name: 'Rule To Delete',
        severity: 'low',
        definition: { field: 'outputTokens', aggregation: 'max', operator: '>', threshold: 200 },
      });
      const ruleId = createRes.body.id;

      const res = await request(app, 'DELETE', `/api/rules/custom/${ruleId}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should return 404 for nonexistent custom rule', async () => {
      const res = await request(app, 'DELETE', '/api/rules/custom/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  // ===== Security =====

  describe('GET /api/security/scan/latest', () => {
    it('should return 404 when no scan exists', async () => {
      const res = await request(app, 'GET', '/api/security/scan/latest');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('No security scan found');
    });

    it('should return latest scan with findings', async () => {
      storage.saveSecurityScan({
        scanId: 'test-scan-1',
        scanType: 'full',
        triggerSource: 'api',
        scannedAt: Date.now(),
        filesScanned: 10,
        linesScanned: 500,
        totalFindings: 1,
        securityScore: { score: 90, grade: 'A' },
        findings: [{
          category: 'leakage',
          ruleId: 'S1',
          ruleName: 'Phone Detection',
          severity: 'high',
          maskedSnippet: '138****5678',
        }],
      });

      const res = await request(app, 'GET', '/api/security/scan/latest');
      expect(res.status).toBe(200);
      expect(res.body.scan).toBeDefined();
      expect(res.body.scan.scanType).toBe('full');
      expect(res.body.findings).toBeDefined();
    });

    it('should filter by scan type', async () => {
      storage.saveSecurityScan({
        scanId: 'test-scan-leakage',
        scanType: 'leakage',
        triggerSource: 'api',
        scannedAt: Date.now(),
        totalFindings: 0,
        securityScore: { score: 100, grade: 'A' },
        findings: [],
      });

      const res = await request(app, 'GET', '/api/security/scan/latest?type=leakage');
      expect(res.status).toBe(200);
      expect(res.body.scan.scanType).toBe('leakage');
    });
  });

  describe('GET /api/security/findings', () => {
    it('should return empty when no scan exists', async () => {
      const res = await request(app, 'GET', '/api/security/findings');
      expect(res.status).toBe(200);
      expect(res.body.findings).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it('should return findings from latest scan', async () => {
      storage.saveSecurityScan({
        scanId: 'findings-scan',
        scanType: 'full',
        triggerSource: 'api',
        scannedAt: Date.now(),
        totalFindings: 2,
        securityScore: { score: 80, grade: 'B' },
        findings: [
          { category: 'leakage', ruleId: 'S1', ruleName: 'Phone', severity: 'high', maskedSnippet: '138****5678' },
          { category: 'leakage', ruleId: 'S7', ruleName: 'API Key', severity: 'critical', maskedSnippet: 'sk-****xxxx' },
        ],
      });

      const res = await request(app, 'GET', '/api/security/findings');
      expect(res.status).toBe(200);
      expect(res.body.findings.length).toBe(2);
      expect(res.body.pagination.total).toBe(2);
    });

    it('should filter by category', async () => {
      storage.saveSecurityScan({
        scanId: 'cat-filter-scan',
        scanType: 'full',
        triggerSource: 'api',
        scannedAt: Date.now(),
        totalFindings: 2,
        findings: [
          { category: 'leakage', ruleId: 'S1', severity: 'high' },
          { category: 'exposure', ruleId: 'port_exposure', severity: 'high', port: 3000 },
        ],
      });

      const res = await request(app, 'GET', '/api/security/findings?category=leakage');
      expect(res.status).toBe(200);
      expect(res.body.findings.every(f => f.category === 'leakage')).toBe(true);
    });

    it('should filter by severity', async () => {
      storage.saveSecurityScan({
        scanId: 'sev-filter-scan',
        scanType: 'full',
        triggerSource: 'api',
        scannedAt: Date.now(),
        totalFindings: 2,
        findings: [
          { category: 'leakage', ruleId: 'S1', severity: 'high' },
          { category: 'leakage', ruleId: 'S9', severity: 'low' },
        ],
      });

      const res = await request(app, 'GET', '/api/security/findings?severity=high');
      expect(res.status).toBe(200);
      expect(res.body.findings.every(f => f.severity === 'high')).toBe(true);
    });

    it('should support pagination', async () => {
      const findings = Array.from({ length: 5 }, (_, i) => ({
        category: 'leakage',
        ruleId: `S${i}`,
        severity: 'medium',
      }));
      storage.saveSecurityScan({
        scanId: 'page-scan',
        scanType: 'full',
        triggerSource: 'api',
        scannedAt: Date.now(),
        totalFindings: 5,
        findings,
      });

      const res = await request(app, 'GET', '/api/security/findings?page=1&pageSize=2');
      expect(res.status).toBe(200);
      expect(res.body.findings.length).toBe(2);
      expect(res.body.pagination.total).toBe(5);
      expect(res.body.pagination.totalPages).toBe(3);
    });
  });

  describe('GET /api/security/rules', () => {
    it('should return security rules list', async () => {
      const res = await request(app, 'GET', '/api/security/rules');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rules');
      expect(res.body).toHaveProperty('totalBuiltIn');
      expect(res.body.rules).toBeInstanceOf(Array);
      expect(res.body.totalBuiltIn).toBeGreaterThan(0);
    });

    it('should include rule fields', async () => {
      const res = await request(app, 'GET', '/api/security/rules');
      const rule = res.body.rules[0];
      expect(rule).toHaveProperty('id');
      expect(rule).toHaveProperty('name');
      expect(rule).toHaveProperty('severity');
      expect(rule).toHaveProperty('builtIn');
      expect(rule).toHaveProperty('category');
    });
  });

  describe('GET /api/security/history', () => {
    it('should return empty history when no scans exist', async () => {
      const res = await request(app, 'GET', '/api/security/history');
      expect(res.status).toBe(200);
      expect(res.body.history).toEqual([]);
      expect(res.body).toHaveProperty('trend');
      expect(res.body).toHaveProperty('trendData');
    });

    it('should return scan history', async () => {
      storage.saveSecurityScan({
        scanId: 'hist-scan-1',
        scanType: 'full',
        triggerSource: 'api',
        scannedAt: Date.now() - 86400000,
        totalFindings: 1,
        securityScore: { score: 85, grade: 'B' },
        findings: [{ category: 'leakage', ruleId: 'S1', severity: 'high' }],
      });
      storage.saveSecurityScan({
        scanId: 'hist-scan-2',
        scanType: 'full',
        triggerSource: 'api',
        scannedAt: Date.now(),
        totalFindings: 0,
        securityScore: { score: 100, grade: 'A' },
        findings: [],
      });

      const res = await request(app, 'GET', '/api/security/history?days=7');
      expect(res.status).toBe(200);
      expect(res.body.history.length).toBe(2);
    });
  });

  describe('GET /api/security/country-defaults', () => {
    it('should return country defaults list', async () => {
      const res = await request(app, 'GET', '/api/security/country-defaults');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('countries');
      expect(res.body.countries).toBeInstanceOf(Array);
      expect(res.body.countries.length).toBeGreaterThan(0);
      expect(res.body.countries[0]).toHaveProperty('code');
      expect(res.body.countries[0]).toHaveProperty('label');
      expect(res.body.countries[0]).toHaveProperty('phone');
      expect(res.body.countries[0]).toHaveProperty('idCard');
    });
  });

  // ===== Analysis Summary =====

  describe('GET /api/analysis/summary', () => {
    it('returns rules with occurrences and sessions after analysis run', async () => {
      // Seed a batch
      storage.saveAnalysisBatch({
        periodStart: Date.now() - 86400000,
        periodEnd: Date.now(),
        totalTokens: 100000,
        totalWastedTokens: 5000,
        healthScore: { score: 80, grade: 'B' },
        byRule: {
          'R1_context_growth': [{
            sessionId: 'sess-abc', agent: 'claude-code',
            severity: 'high', detail: { growthRate: 2.5 }, evidence: [], estimatedWastedTokens: 3200,
          }],
        },
      });

      const res = await request(app, 'GET', '/api/analysis/summary');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.rules)).toBe(true);
      const rule = res.body.rules.find(r => r.id === 'R1_context_growth');
      expect(rule).toBeDefined();
      expect(rule.severity).toBe('high');
      expect(rule.occurrences).toBeGreaterThan(0);
      expect(rule.estimatedWaste).toBe(3200);
      expect(Array.isArray(rule.sessions)).toBe(true);
      expect(rule.sessions[0]).toMatchObject({
        sessionId: 'sess-abc',
        agent: 'claude-code',
        waste: 3200,
      });
    });

    it('returns empty rules when no analysis has run', async () => {
      const res = await request(app, 'GET', '/api/analysis/summary');
      expect(res.status).toBe(200);
      expect(res.body.rules).toEqual([]);
    });
  });

  // ===== 404 for unmatched API routes =====

  describe('API 404 handling', () => {
    it('should return 404 for unknown API routes', async () => {
      const res = await request(app, 'GET', '/api/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('API endpoint not found');
    });
  });
});
