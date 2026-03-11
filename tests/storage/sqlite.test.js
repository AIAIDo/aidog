import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../../src/storage/sqlite.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createMockEvent(overrides = {}) {
  const id = `claude-code:msg_${Math.random().toString(36).slice(2)}`;
  return {
    id,
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

describe('SQLiteStorage', () => {
  let storage;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidog-test-'));
    const dbPath = join(tmpDir, 'test.db');
    storage = new SQLiteStorage(dbPath);
  });

  afterEach(() => {
    if (storage) {
      storage.close();
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('init', () => {
    it('should create tables on initialization', () => {
      const tables = storage.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => r.name);

      expect(tables).toContain('token_events');
      expect(tables).toContain('analysis_results');
      expect(tables).toContain('analysis_batches');
      expect(tables).toContain('sync_meta');
      expect(tables).toContain('ai_reports');
    });
  });

  describe('ingestEvents', () => {
    it('should insert events into the database', () => {
      const events = [createMockEvent(), createMockEvent()];
      storage.ingestEvents(events);

      const count = storage.db.prepare('SELECT COUNT(*) AS cnt FROM token_events').get();
      expect(count.cnt).toBe(2);
    });

    it('should deduplicate events with same id (INSERT OR IGNORE)', () => {
      const event = createMockEvent({ id: 'duplicate-id' });
      storage.ingestEvents([event]);
      storage.ingestEvents([event]);

      const count = storage.db.prepare('SELECT COUNT(*) AS cnt FROM token_events').get();
      expect(count.cnt).toBe(1);
    });

    it('should handle empty events array', () => {
      storage.ingestEvents([]);
      const count = storage.db.prepare('SELECT COUNT(*) AS cnt FROM token_events').get();
      expect(count.cnt).toBe(0);
    });

    it('should handle null/undefined input', () => {
      storage.ingestEvents(null);
      storage.ingestEvents(undefined);
      const count = storage.db.prepare('SELECT COUNT(*) AS cnt FROM token_events').get();
      expect(count.cnt).toBe(0);
    });

    it('should handle Date objects for timestamp', () => {
      const event = createMockEvent({ timestamp: new Date('2025-06-01T12:00:00Z') });
      storage.ingestEvents([event]);

      const row = storage.db.prepare('SELECT timestamp FROM token_events').get();
      expect(row.timestamp).toBe(new Date('2025-06-01T12:00:00Z').getTime());
    });
  });

  describe('queryByDateRange', () => {
    it('should return events within the date range', () => {
      const now = Date.now();
      const events = [
        createMockEvent({ timestamp: now - 3600000 }),
        createMockEvent({ timestamp: now - 1800000 }),
        createMockEvent({ timestamp: now - 86400000 * 10 }),
      ];
      storage.ingestEvents(events);

      const results = storage.queryByDateRange(now - 7200000, now);
      expect(results).toHaveLength(2);
    });

    it('should filter by agent when provided', () => {
      const now = Date.now();
      const events = [
        createMockEvent({ agent: 'claude-code', timestamp: now - 1000 }),
        createMockEvent({ agent: 'aider', timestamp: now - 2000 }),
      ];
      storage.ingestEvents(events);

      const results = storage.queryByDateRange(now - 10000, now, 'claude-code');
      expect(results).toHaveLength(1);
      expect(results[0].agent).toBe('claude-code');
    });

    it('should return results ordered by timestamp ASC', () => {
      const now = Date.now();
      const events = [
        createMockEvent({ timestamp: now - 1000 }),
        createMockEvent({ timestamp: now - 3000 }),
        createMockEvent({ timestamp: now - 2000 }),
      ];
      storage.ingestEvents(events);

      const results = storage.queryByDateRange(now - 5000, now);
      expect(results[0].timestamp).toBeLessThan(results[1].timestamp);
      expect(results[1].timestamp).toBeLessThan(results[2].timestamp);
    });
  });

  describe('queryBySession', () => {
    it('should return events for a specific session', () => {
      const events = [
        createMockEvent({ sessionId: 'session-A' }),
        createMockEvent({ sessionId: 'session-A' }),
        createMockEvent({ sessionId: 'session-B' }),
      ];
      storage.ingestEvents(events);

      const results = storage.queryBySession('session-A');
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.sessionId).toBe('session-A'));
    });

    it('should return empty array for nonexistent session', () => {
      const results = storage.queryBySession('nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('getDailySummary', () => {
    it('should return daily aggregated data', () => {
      const today = new Date().toISOString().slice(0, 10);
      const events = [
        createMockEvent({ inputTokens: 1000, outputTokens: 500, date: today }),
        createMockEvent({ inputTokens: 2000, outputTokens: 1000, date: today }),
      ];
      storage.ingestEvents(events);

      const summary = storage.getDailySummary(7);
      expect(summary.length).toBeGreaterThanOrEqual(1);

      const todaySummary = summary.find((s) => s.date === today);
      expect(todaySummary).toBeDefined();
      expect(todaySummary.totalInput).toBe(3000);
      expect(todaySummary.totalOutput).toBe(1500);
      expect(todaySummary.eventCount).toBe(2);
    });
  });

  describe('getMonthlySummary', () => {
    it('should return monthly aggregated data', () => {
      const now = new Date();
      const monthStr = now.toISOString().slice(0, 7);
      const events = [
        createMockEvent({ inputTokens: 5000, outputTokens: 2000 }),
        createMockEvent({ inputTokens: 3000, outputTokens: 1000 }),
      ];
      storage.ingestEvents(events);

      const summary = storage.getMonthlySummary(1);
      expect(summary.length).toBeGreaterThanOrEqual(1);

      const thisMonth = summary.find((s) => s.month === monthStr);
      expect(thisMonth).toBeDefined();
      expect(thisMonth.totalInput).toBe(8000);
      expect(thisMonth.totalOutput).toBe(3000);
    });
  });

  describe('saveAnalysisBatch and getLatestBatch', () => {
    it('should save and retrieve analysis batch', () => {
      const aggregated = {
        periodStart: Date.now() - 86400000,
        periodEnd: Date.now(),
        totalTokens: 100000,
        totalWastedTokens: 20000,
        healthScore: 75,
        byRule: {
          R1_context_growth: [
            {
              sessionId: 'sess-1',
              agent: 'claude-code',
              severity: 'high',
              detail: 'context grew',
              evidence: [{ eventId: 'evt-1' }],
              suggestion: 'Split session',
            },
          ],
        },
      };

      const batchId = storage.saveAnalysisBatch(aggregated);
      expect(batchId).toBeDefined();
      expect(typeof batchId).toBe('string');

      const latest = storage.getLatestBatch();
      expect(latest).not.toBeNull();
      expect(latest.id).toBe(batchId);
      expect(latest.total_tokens).toBe(100000);
      expect(latest.total_wasted).toBe(20000);
    });

    it('persists totalWastedTokens from engine output shape', () => {
      const aggregated = {
        periodStart: Date.now() - 86400000,
        periodEnd: Date.now(),
        totalTokens: 100000,
        totalWastedTokens: 25000,  // engine's actual field name
        healthScore: { score: 80, grade: 'B' },
        byRule: {},
      };
      storage.saveAnalysisBatch(aggregated);
      const latest = storage.getLatestBatch();
      expect(latest.total_wasted).toBe(25000);  // FAIL before fix
    });

    it('should return null when no batches exist', () => {
      const latest = storage.getLatestBatch();
      expect(latest).toBeNull();
    });
  });

  describe('getEventsByIds', () => {
    it('should return events matching the given ids', () => {
      const event1 = createMockEvent({ id: 'evt-1' });
      const event2 = createMockEvent({ id: 'evt-2' });
      const event3 = createMockEvent({ id: 'evt-3' });
      storage.ingestEvents([event1, event2, event3]);

      const results = storage.getEventsByIds(['evt-1', 'evt-3']);
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r.id);
      expect(ids).toContain('evt-1');
      expect(ids).toContain('evt-3');
    });

    it('should return empty array for empty input', () => {
      expect(storage.getEventsByIds([])).toEqual([]);
      expect(storage.getEventsByIds(null)).toEqual([]);
    });
  });

  describe('sync meta', () => {
    it('should set and get sync metadata', () => {
      storage.setSyncMeta('last_sync', '2025-01-15');
      const value = storage.getSyncMeta('last_sync');
      expect(value).toBe('2025-01-15');
    });

    it('should return null for nonexistent key', () => {
      const value = storage.getSyncMeta('nonexistent');
      expect(value).toBeNull();
    });

    it('should overwrite existing key', () => {
      storage.setSyncMeta('cursor', '100');
      storage.setSyncMeta('cursor', '200');
      expect(storage.getSyncMeta('cursor')).toBe('200');
    });
  });

  describe('ingestEvents with plugin format', () => {
    it('should handle events with usage object (plugin format)', () => {
      const event = {
        id: 'claude-code:msg_plugin_1',
        agent: 'claude-code',
        sessionId: 'plugin-session',
        project: 'my-project',
        timestamp: new Date(),
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 3000,
          output_tokens: 1500,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 100,
        },
        toolCalls: [{ type: 'tool_use', name: 'read_file' }],
      };
      storage.ingestEvents([event]);

      const rows = storage.queryBySession('plugin-session');
      expect(rows).toHaveLength(1);
      expect(rows[0].inputTokens).toBe(3000);
      expect(rows[0].outputTokens).toBe(1500);
      expect(rows[0].cacheWrite).toBe(200);
      expect(rows[0].cacheRead).toBe(100);
      expect(rows[0].projectName).toBe('my-project');
    });

    it('should auto-generate sourceMessageId when missing', () => {
      const event = {
        id: 'claude-code:msg_no_src',
        agent: 'claude-code',
        sessionId: 'no-src-session',
        project: 'test',
        timestamp: Date.now(),
        role: 'user',
        usage: { input_tokens: 100, output_tokens: 0 },
      };
      storage.ingestEvents([event]);

      const rows = storage.queryBySession('no-src-session');
      expect(rows).toHaveLength(1);
    });
  });

  describe('querySessionMessages', () => {
    it('should return paginated messages for a session', () => {
      const events = Array.from({ length: 25 }, (_, i) =>
        createMockEvent({
          sessionId: 'paged-session',
          timestamp: Date.now() + i * 1000,
          role: i % 2 === 0 ? 'user' : 'assistant',
        })
      );
      storage.ingestEvents(events);

      const page1 = storage.querySessionMessages('paged-session', { page: 1, pageSize: 10 });
      expect(page1.messages).toHaveLength(10);
      expect(page1.pagination.total).toBe(25);
      expect(page1.pagination.totalPages).toBe(3);
      expect(page1.pagination.page).toBe(1);

      const page3 = storage.querySessionMessages('paged-session', { page: 3, pageSize: 10 });
      expect(page3.messages).toHaveLength(5);
    });

    it('should support search filtering', () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'search-sess', role: 'user', model: 'claude-opus' }),
        createMockEvent({ sessionId: 'search-sess', role: 'assistant', model: 'claude-sonnet' }),
        createMockEvent({ sessionId: 'search-sess', role: 'assistant', model: 'claude-opus' }),
      ]);

      const result = storage.querySessionMessages('search-sess', { search: 'opus' });
      expect(result.messages).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should return empty result for nonexistent session', () => {
      const result = storage.querySessionMessages('nonexistent');
      expect(result.messages).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should search message content via FTS', () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'fts-sess', content: JSON.stringify([{ type: 'text', text: 'Hello world from assistant' }]) }),
        createMockEvent({ sessionId: 'fts-sess', content: JSON.stringify('Goodbye cruel world') }),
        createMockEvent({ sessionId: 'fts-sess', content: null }),
      ]);

      const result = storage.querySessionMessages('fts-sess', { search: 'Hello' });
      expect(result.messages).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should combine FTS content search with metadata search', () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'combo-sess', role: 'user', content: JSON.stringify('unique-content-xyz') }),
        createMockEvent({ sessionId: 'combo-sess', role: 'special-role', content: null }),
        createMockEvent({ sessionId: 'combo-sess', role: 'assistant', content: JSON.stringify('other content') }),
      ]);

      // Search by content
      const r1 = storage.querySessionMessages('combo-sess', { search: 'unique-content-xyz' });
      expect(r1.messages).toHaveLength(1);

      // Search by role (metadata) still works
      const r2 = storage.querySessionMessages('combo-sess', { search: 'special-role' });
      expect(r2.messages).toHaveLength(1);
    });

    it('should return empty for FTS search with no matches', () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'empty-fts', content: JSON.stringify('some text') }),
      ]);

      const result = storage.querySessionMessages('empty-fts', { search: 'nonexistent-term-zzz' });
      expect(result.messages).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should handle special characters in FTS search gracefully', () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'special-sess', content: JSON.stringify('normal text') }),
      ]);

      // Should not throw on special FTS characters
      const result = storage.querySessionMessages('special-sess', { search: '"AND OR NOT"' });
      expect(result.pagination).toBeDefined();
    });
  });

  describe('listSessions FTS', () => {
    it('should find sessions by message content', () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'content-sess-1', content: JSON.stringify('deploy to production server') }),
        createMockEvent({ sessionId: 'content-sess-2', content: JSON.stringify('fix login bug') }),
      ]);

      const result = storage.listSessions({ search: 'production' });
      expect(result.total).toBe(1);
      expect(result.sessions[0].sessionId).toBe('content-sess-1');
    });

    it('should combine FTS and metadata search in session list', () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'meta-sess', agent: 'claude-code', content: JSON.stringify('unrelated text') }),
        createMockEvent({ sessionId: 'content-sess', agent: 'cursor', content: JSON.stringify('search-keyword-abc') }),
      ]);

      // FTS match on content
      const r1 = storage.listSessions({ search: 'search-keyword-abc' });
      expect(r1.total).toBe(1);
      expect(r1.sessions[0].sessionId).toBe('content-sess');

      // Metadata match on sessionId still works
      const r2 = storage.listSessions({ search: 'meta-sess' });
      expect(r2.total).toBe(1);
      expect(r2.sessions[0].sessionId).toBe('meta-sess');
    });

    it('should return no sessions when FTS and metadata both have no match', () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'some-sess', content: JSON.stringify('hello world') }),
      ]);

      const result = storage.listSessions({ search: 'completely-nonexistent-xyz' });
      expect(result.total).toBe(0);
      expect(result.sessions).toHaveLength(0);
    });

    it('should handle content as array of blocks for FTS', () => {
      storage.ingestEvents([
        createMockEvent({
          sessionId: 'blocks-sess',
          content: JSON.stringify([
            { type: 'text', text: 'The deployment pipeline is running' },
            { type: 'tool_use', name: 'read_file', input: { path: '/etc/config' } },
          ]),
        }),
      ]);

      // Search text block content
      const r1 = storage.listSessions({ search: 'deployment pipeline' });
      expect(r1.total).toBe(1);

      // Search tool_use name
      const r2 = storage.listSessions({ search: 'read_file' });
      expect(r2.total).toBe(1);
    });
  });

  describe('FTS index population', () => {
    it('should not index duplicate events into FTS', () => {
      const event = createMockEvent({ sessionId: 'dup-sess', content: JSON.stringify('unique text for dup test') });
      storage.ingestEvents([event]);
      storage.ingestEvents([event]); // duplicate

      const result = storage.querySessionMessages('dup-sess', { search: 'unique text' });
      expect(result.messages).toHaveLength(1);
    });

    it('should skip FTS indexing for events with null content', () => {
      storage.ingestEvents([
        createMockEvent({ sessionId: 'null-content-sess', content: null }),
      ]);

      const result = storage.listSessions({ search: 'null-content-sess' });
      // Should match via metadata (sessionId), not FTS
      expect(result.total).toBe(1);
    });
  });

  describe('AI report', () => {
    it('should save and retrieve AI report', () => {
      const report = {
        period: '2025-01',
        agent: 'claude-code',
        inputHash: 'hash123',
        report: JSON.stringify({ issues: [], summary: {} }),
        modelUsed: 'claude-sonnet-4-20250514',
      };

      const id = storage.saveAIReport(report);
      expect(typeof id).toBe('string');

      const retrieved = storage.getAIReport('hash123');
      expect(retrieved).not.toBeNull();
      expect(retrieved.input_hash).toBe('hash123');
      expect(retrieved.model_used).toBe('claude-sonnet-4-20250514');
    });

    it('should return null for nonexistent hash', () => {
      const result = storage.getAIReport('nonexistent');
      expect(result).toBeNull();
    });

    it('should parse JSON report when retrieving', () => {
      const reportData = { issues: ['issue1'], summary: { total: 100 } };
      storage.saveAIReport({
        inputHash: 'json-hash',
        report: JSON.stringify(reportData),
      });

      const retrieved = storage.getAIReport('json-hash');
      expect(retrieved.report).toEqual(reportData);
    });
  });
});
