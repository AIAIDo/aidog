import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract a short title from the first content block of a session.
 * Content is stored as JSON (array of blocks or a string).
 */
/**
 * Extract plain text from JSON content for FTS indexing.
 */
function extractPlainText(rawContent) {
  if (!rawContent) return '';
  try {
    const parsed = JSON.parse(rawContent);
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) {
      return parsed.map(block => {
        if (typeof block === 'string') return block;
        if (block.type === 'text') return block.text || '';
        if (block.type === 'tool_use') return `${block.name || ''} ${typeof block.input === 'string' ? block.input : JSON.stringify(block.input || '')}`;
        if (block.type === 'tool_result') {
          if (typeof block.content === 'string') return block.content;
          if (Array.isArray(block.content)) return block.content.map(c => c.text || '').join(' ');
          return '';
        }
        return '';
      }).filter(Boolean).join('\n');
    }
  } catch {
    if (typeof rawContent === 'string') return rawContent;
  }
  return '';
}

function extractSessionTitle(rawContent) {
  if (!rawContent) return null;
  try {
    const parsed = JSON.parse(rawContent);
    if (typeof parsed === 'string') return parsed.slice(0, 120).split('\n')[0];
    if (Array.isArray(parsed)) {
      const textBlock = parsed.find(b => b.type === 'text' && b.text);
      if (textBlock) return textBlock.text.slice(0, 120).split('\n')[0];
    }
    if (parsed && parsed.type === 'text' && parsed.text) return parsed.text.slice(0, 120).split('\n')[0];
  } catch {
    // SUBSTR may truncate JSON - try regex extraction for "text":"..." pattern
    const textMatch = rawContent.match(/"type"\s*:\s*"text".*?"text"\s*:\s*"([^"]{1,120})/);
    if (textMatch) return textMatch[1].split('\\n')[0];
    // Try plain string
    if (typeof rawContent === 'string' && !rawContent.startsWith('[')) {
      return rawContent.slice(0, 120).split('\n')[0];
    }
  }
  return null;
}

export class SQLiteStorage {
  constructor(dbPath) {
    this.dbPath = dbPath || join(homedir(), '.aidog', 'data.db');
    this.db = null;
    this.init();
  }

  init() {
    const dir = dirname(this.dbPath);
    mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    this.db.exec(schema);

    // Migration: add content column if missing (for existing DBs)
    try {
      this.db.exec('ALTER TABLE token_events ADD COLUMN content TEXT');
    } catch { /* column already exists */ }

    // Migration: add estimated_wasted_tokens column to analysis_results if missing
    try {
      this.db.exec('ALTER TABLE analysis_results ADD COLUMN estimated_wasted_tokens INTEGER DEFAULT 0');
    } catch { /* column already exists */ }

    // Create FTS5 virtual table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS token_events_fts USING fts5(
        event_id UNINDEXED,
        session_id UNINDEXED,
        plain_text,
        tokenize='unicode61'
      )
    `);

    // Hot path indexes for session list/message pagination.
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_time ON token_events(session_id, timestamp)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agent_timestamp ON token_events(agent, timestamp)');

    // Migration: populate FTS index from existing data
    const ftsMigrated = this.db.prepare(
      "SELECT value FROM sync_meta WHERE key = 'fts_migrated'"
    ).get();
    if (!ftsMigrated) {
      this._populateFtsIndex();
      this.db.prepare(
        "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('fts_migrated', '1')"
      ).run();
    }

    // Migration: add local binding columns to security_findings
    for (const col of ['bind_address TEXT', 'process_name TEXT', 'process_pid INTEGER']) {
      try {
        this.db.exec(`ALTER TABLE security_findings ADD COLUMN ${col}`);
      } catch { /* column already exists */ }
    }

    this._prepareStatements();
  }

  _prepareStatements() {
    this._stmts = {
      insertEvent: this.db.prepare(`
        INSERT OR IGNORE INTO token_events
          (id, agent, source_message_id, session_id, project_path, project_name,
           timestamp, role, model, input_tokens, output_tokens, cache_read,
           cache_write, tool_calls, content_length, content, date)
        VALUES
          (@id, @agent, @sourceMessageId, @sessionId, @projectPath, @projectName,
           @timestamp, @role, @model, @inputTokens, @outputTokens, @cacheRead,
           @cacheWrite, @toolCalls, @contentLength, @content, @date)
      `),

      queryByDateRange: this.db.prepare(`
        SELECT * FROM token_events
        WHERE timestamp >= @start AND timestamp <= @end
        ORDER BY timestamp ASC
      `),

      queryByDateRangeAgent: this.db.prepare(`
        SELECT * FROM token_events
        WHERE timestamp >= @start AND timestamp <= @end AND agent = @agent
        ORDER BY timestamp ASC
      `),

      queryBySession: this.db.prepare(`
        SELECT * FROM token_events
        WHERE session_id = @sessionId
        ORDER BY timestamp ASC
      `),

      listSessions: this.db.prepare(`
        SELECT
          session_id,
          MIN(agent) AS agent,
          MIN(project_name) AS project_name,
          MIN(project_path) AS project_path,
          MIN(timestamp) AS start_time,
          MAX(timestamp) AS end_time,
          COUNT(*) AS event_count,
          SUM(input_tokens) AS total_input,
          SUM(output_tokens) AS total_output,
          SUM(input_tokens + output_tokens) AS total_tokens,
          SUM(cache_read) AS total_cache_read,
          SUM(cache_write) AS total_cache_write,
          GROUP_CONCAT(DISTINCT model) AS models,
          COALESCE(
            (SELECT SUBSTR(content, 1, 500) FROM token_events t2
             WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.role = 'user'
             ORDER BY t2.timestamp ASC LIMIT 1),
            (SELECT SUBSTR(content, 1, 500) FROM token_events t2
             WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.content LIKE '%"type":"text"%'
             ORDER BY t2.timestamp ASC LIMIT 1),
            (SELECT SUBSTR(content, 1, 500) FROM token_events t2
             WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL
             ORDER BY t2.timestamp ASC LIMIT 1)
          ) AS first_content
        FROM token_events
        WHERE timestamp >= @start AND timestamp <= @end
        GROUP BY session_id
        ORDER BY MAX(timestamp) DESC
      `),

      listDistinctAgents: this.db.prepare(`
        SELECT DISTINCT agent FROM token_events ORDER BY agent
      `),

      listSessionsAgent: this.db.prepare(`
        SELECT
          session_id,
          MIN(agent) AS agent,
          MIN(project_name) AS project_name,
          MIN(project_path) AS project_path,
          MIN(timestamp) AS start_time,
          MAX(timestamp) AS end_time,
          COUNT(*) AS event_count,
          SUM(input_tokens) AS total_input,
          SUM(output_tokens) AS total_output,
          SUM(input_tokens + output_tokens) AS total_tokens,
          SUM(cache_read) AS total_cache_read,
          SUM(cache_write) AS total_cache_write,
          GROUP_CONCAT(DISTINCT model) AS models,
          COALESCE(
            (SELECT SUBSTR(content, 1, 500) FROM token_events t2
             WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.role = 'user'
             ORDER BY t2.timestamp ASC LIMIT 1),
            (SELECT SUBSTR(content, 1, 500) FROM token_events t2
             WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.content LIKE '%"type":"text"%'
             ORDER BY t2.timestamp ASC LIMIT 1),
            (SELECT SUBSTR(content, 1, 500) FROM token_events t2
             WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL
             ORDER BY t2.timestamp ASC LIMIT 1)
          ) AS first_content
        FROM token_events
        WHERE timestamp >= @start AND timestamp <= @end AND agent = @agent
        GROUP BY session_id
        ORDER BY MAX(timestamp) DESC
      `),

      countDistinctSessions: this.db.prepare(`
        SELECT COUNT(DISTINCT session_id) AS total
        FROM token_events
        WHERE timestamp >= @start AND timestamp <= @end
      `),

      countDistinctSessionsAgent: this.db.prepare(`
        SELECT COUNT(DISTINCT session_id) AS total
        FROM token_events
        WHERE timestamp >= @start AND timestamp <= @end AND agent = @agent
      `),

      listSessionsPaged: this.db.prepare(`
        WITH session_summary AS (
          SELECT
            session_id,
            MIN(agent) AS agent,
            MIN(project_name) AS project_name,
            MIN(project_path) AS project_path,
            MIN(timestamp) AS start_time,
            MAX(timestamp) AS end_time,
            COUNT(*) AS event_count,
            SUM(input_tokens) AS total_input,
            SUM(output_tokens) AS total_output,
            SUM(input_tokens + output_tokens) AS total_tokens,
            SUM(cache_read) AS total_cache_read,
            SUM(cache_write) AS total_cache_write,
            GROUP_CONCAT(DISTINCT model) AS models,
            COALESCE(
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.role = 'user'
               ORDER BY t2.timestamp ASC LIMIT 1),
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.content LIKE '%"type":"text"%'
               ORDER BY t2.timestamp ASC LIMIT 1),
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL
               ORDER BY t2.timestamp ASC LIMIT 1)
            ) AS first_content
          FROM token_events
          WHERE timestamp >= @start AND timestamp <= @end
          GROUP BY session_id
        )
        SELECT * FROM session_summary
        ORDER BY end_time DESC
        LIMIT @limit OFFSET @offset
      `),

      listSessionsPagedAgent: this.db.prepare(`
        WITH session_summary AS (
          SELECT
            session_id,
            MIN(agent) AS agent,
            MIN(project_name) AS project_name,
            MIN(project_path) AS project_path,
            MIN(timestamp) AS start_time,
            MAX(timestamp) AS end_time,
            COUNT(*) AS event_count,
            SUM(input_tokens) AS total_input,
            SUM(output_tokens) AS total_output,
            SUM(input_tokens + output_tokens) AS total_tokens,
            SUM(cache_read) AS total_cache_read,
            SUM(cache_write) AS total_cache_write,
            GROUP_CONCAT(DISTINCT model) AS models,
            COALESCE(
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.role = 'user'
               ORDER BY t2.timestamp ASC LIMIT 1),
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.content LIKE '%"type":"text"%'
               ORDER BY t2.timestamp ASC LIMIT 1),
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL
               ORDER BY t2.timestamp ASC LIMIT 1)
            ) AS first_content
          FROM token_events
          WHERE timestamp >= @start AND timestamp <= @end AND agent = @agent
          GROUP BY session_id
        )
        SELECT * FROM session_summary
        ORDER BY end_time DESC
        LIMIT @limit OFFSET @offset
      `),

      listSessionsSearch: this.db.prepare(`
        WITH session_summary AS (
          SELECT
            session_id,
            MIN(agent) AS agent,
            MIN(project_name) AS project_name,
            MIN(project_path) AS project_path,
            MIN(timestamp) AS start_time,
            MAX(timestamp) AS end_time,
            COUNT(*) AS event_count,
            SUM(input_tokens) AS total_input,
            SUM(output_tokens) AS total_output,
            SUM(input_tokens + output_tokens) AS total_tokens,
            SUM(cache_read) AS total_cache_read,
            SUM(cache_write) AS total_cache_write,
            GROUP_CONCAT(DISTINCT model) AS models,
            COALESCE(
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.role = 'user'
               ORDER BY t2.timestamp ASC LIMIT 1),
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.content LIKE '%"type":"text"%'
               ORDER BY t2.timestamp ASC LIMIT 1),
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL
               ORDER BY t2.timestamp ASC LIMIT 1)
            ) AS first_content
          FROM token_events
          WHERE timestamp >= @start AND timestamp <= @end
          GROUP BY session_id
        )
        SELECT * FROM session_summary
        WHERE lower(coalesce(session_id, '') || ' ' || coalesce(agent, '') || ' ' || coalesce(project_name, '') || ' ' || coalesce(project_path, '')) LIKE @searchLike
          OR session_id IN (
            SELECT DISTINCT session_id FROM token_events_fts WHERE token_events_fts MATCH @ftsQuery
          )
        ORDER BY end_time DESC
        LIMIT @limit OFFSET @offset
      `),

      countSessionsSearch: this.db.prepare(`
        WITH session_summary AS (
          SELECT
            session_id,
            MIN(agent) AS agent,
            MIN(project_name) AS project_name,
            MIN(project_path) AS project_path
          FROM token_events
          WHERE timestamp >= @start AND timestamp <= @end
          GROUP BY session_id
        )
        SELECT COUNT(*) AS total
        FROM session_summary
        WHERE lower(coalesce(session_id, '') || ' ' || coalesce(agent, '') || ' ' || coalesce(project_name, '') || ' ' || coalesce(project_path, '')) LIKE @searchLike
          OR session_id IN (
            SELECT DISTINCT session_id FROM token_events_fts WHERE token_events_fts MATCH @ftsQuery
          )
      `),

      listSessionsSearchAgent: this.db.prepare(`
        WITH session_summary AS (
          SELECT
            session_id,
            MIN(agent) AS agent,
            MIN(project_name) AS project_name,
            MIN(project_path) AS project_path,
            MIN(timestamp) AS start_time,
            MAX(timestamp) AS end_time,
            COUNT(*) AS event_count,
            SUM(input_tokens) AS total_input,
            SUM(output_tokens) AS total_output,
            SUM(input_tokens + output_tokens) AS total_tokens,
            SUM(cache_read) AS total_cache_read,
            SUM(cache_write) AS total_cache_write,
            GROUP_CONCAT(DISTINCT model) AS models,
            COALESCE(
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.role = 'user'
               ORDER BY t2.timestamp ASC LIMIT 1),
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.content LIKE '%"type":"text"%'
               ORDER BY t2.timestamp ASC LIMIT 1),
              (SELECT SUBSTR(content, 1, 500) FROM token_events t2
               WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL
               ORDER BY t2.timestamp ASC LIMIT 1)
            ) AS first_content
          FROM token_events
          WHERE timestamp >= @start AND timestamp <= @end AND agent = @agent
          GROUP BY session_id
        )
        SELECT * FROM session_summary
        WHERE lower(coalesce(session_id, '') || ' ' || coalesce(agent, '') || ' ' || coalesce(project_name, '') || ' ' || coalesce(project_path, '')) LIKE @searchLike
          OR session_id IN (
            SELECT DISTINCT session_id FROM token_events_fts WHERE token_events_fts MATCH @ftsQuery
          )
        ORDER BY end_time DESC
        LIMIT @limit OFFSET @offset
      `),

      countSessionsSearchAgent: this.db.prepare(`
        WITH session_summary AS (
          SELECT
            session_id,
            MIN(agent) AS agent,
            MIN(project_name) AS project_name,
            MIN(project_path) AS project_path
          FROM token_events
          WHERE timestamp >= @start AND timestamp <= @end AND agent = @agent
          GROUP BY session_id
        )
        SELECT COUNT(*) AS total
        FROM session_summary
        WHERE lower(coalesce(session_id, '') || ' ' || coalesce(agent, '') || ' ' || coalesce(project_name, '') || ' ' || coalesce(project_path, '')) LIKE @searchLike
          OR session_id IN (
            SELECT DISTINCT session_id FROM token_events_fts WHERE token_events_fts MATCH @ftsQuery
          )
      `),

      countSessionMessages: this.db.prepare(`
        SELECT COUNT(*) AS total FROM token_events WHERE session_id = @sessionId
      `),

      querySessionMessagesPaged: this.db.prepare(`
        SELECT id, agent, source_message_id, session_id, project_path, project_name,
          timestamp, role, model, input_tokens, output_tokens, cache_read,
          cache_write, tool_calls, content_length, date
        FROM token_events
        WHERE session_id = @sessionId
        ORDER BY timestamp ASC
        LIMIT @limit OFFSET @offset
      `),

      countSessionMessagesSearch: this.db.prepare(`
        SELECT COUNT(*) AS total
        FROM token_events te
        WHERE te.session_id = @sessionId
          AND (
            te.id IN (
              SELECT event_id FROM token_events_fts
              WHERE session_id = @sessionId AND token_events_fts MATCH @ftsQuery
            )
            OR te.role LIKE @like OR te.model LIKE @like OR te.tool_calls LIKE @like
          )
      `),

      querySessionMessagesSearch: this.db.prepare(`
        SELECT id, agent, source_message_id, session_id, project_path, project_name,
          timestamp, role, model, input_tokens, output_tokens, cache_read,
          cache_write, tool_calls, content_length, date
        FROM token_events te
        WHERE te.session_id = @sessionId
          AND (
            te.id IN (
              SELECT event_id FROM token_events_fts
              WHERE session_id = @sessionId AND token_events_fts MATCH @ftsQuery
            )
            OR te.role LIKE @like OR te.model LIKE @like OR te.tool_calls LIKE @like
          )
        ORDER BY timestamp ASC
        LIMIT @limit OFFSET @offset
      `),

      countSessionMessagesMetaSearch: this.db.prepare(`
        SELECT COUNT(*) AS total
        FROM token_events
        WHERE session_id = @sessionId
          AND (role LIKE @like OR model LIKE @like OR tool_calls LIKE @like)
      `),

      querySessionMessagesMetaSearch: this.db.prepare(`
        SELECT id, agent, source_message_id, session_id, project_path, project_name,
          timestamp, role, model, input_tokens, output_tokens, cache_read,
          cache_write, tool_calls, content_length, date
        FROM token_events
        WHERE session_id = @sessionId
          AND (role LIKE @like OR model LIKE @like OR tool_calls LIKE @like)
        ORDER BY timestamp ASC
        LIMIT @limit OFFSET @offset
      `),

      dailySummary: this.db.prepare(`
        SELECT
          date,
          SUM(input_tokens) AS totalInput,
          SUM(output_tokens) AS totalOutput,
          SUM(cache_read) AS totalCacheRead,
          SUM(cache_write) AS totalCacheWrite,
          COUNT(*) AS eventCount,
          COUNT(DISTINCT session_id) AS sessionCount
        FROM token_events
        WHERE date >= @since
        GROUP BY date
        ORDER BY date DESC
      `),

      dailySummaryAgent: this.db.prepare(`
        SELECT
          date,
          SUM(input_tokens) AS totalInput,
          SUM(output_tokens) AS totalOutput,
          SUM(cache_read) AS totalCacheRead,
          SUM(cache_write) AS totalCacheWrite,
          COUNT(*) AS eventCount,
          COUNT(DISTINCT session_id) AS sessionCount
        FROM token_events
        WHERE date >= @since AND agent = @agent
        GROUP BY date
        ORDER BY date DESC
      `),

      monthlySummary: this.db.prepare(`
        SELECT
          substr(date, 1, 7) AS month,
          SUM(input_tokens) AS totalInput,
          SUM(output_tokens) AS totalOutput,
          SUM(cache_read) AS totalCacheRead,
          SUM(cache_write) AS totalCacheWrite,
          COUNT(*) AS eventCount,
          COUNT(DISTINCT session_id) AS sessionCount
        FROM token_events
        WHERE date >= @since
        GROUP BY month
        ORDER BY month DESC
      `),

      insertAnalysisBatch: this.db.prepare(`
        INSERT INTO analysis_batches
          (id, period_start, period_end, total_tokens, total_wasted, health_score, rule_count, created_at)
        VALUES
          (@id, @periodStart, @periodEnd, @totalTokens, @totalWasted, @healthScore, @ruleCount, @createdAt)
      `),

      insertAnalysisResult: this.db.prepare(`
        INSERT INTO analysis_results
          (id, batch_id, session_id, agent, rule, severity, detail, evidence, suggestion, estimated_wasted_tokens, created_at)
        VALUES
          (@id, @batchId, @sessionId, @agent, @rule, @severity, @detail, @evidence, @suggestion, @estimatedWastedTokens, @createdAt)
      `),

      getRuleStats: this.db.prepare(`
        SELECT rule, COUNT(*) as occurrences, SUM(estimated_wasted_tokens) as estimated_wasted_tokens
        FROM analysis_results
        GROUP BY rule
      `),

      getAnalysisResults: this.db.prepare(`
        SELECT * FROM analysis_results
        WHERE session_id = @sessionId
        ORDER BY created_at DESC
      `),

      getLatestBatch: this.db.prepare(`
        SELECT * FROM analysis_batches
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `),

      getSessionTimeline: this.db.prepare(`
        SELECT * FROM token_events
        WHERE session_id = @sessionId
        ORDER BY timestamp ASC
      `),

      getSyncMeta: this.db.prepare(`
        SELECT value FROM sync_meta WHERE key = @key
      `),

      setSyncMeta: this.db.prepare(`
        INSERT INTO sync_meta (key, value) VALUES (@key, @value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `),

      insertAIReport: this.db.prepare(`
        INSERT INTO ai_reports (id, period, agent, input_hash, report, model_used, created_at)
        VALUES (@id, @period, @agent, @inputHash, @report, @modelUsed, @createdAt)
      `),

      getAIReport: this.db.prepare(`
        SELECT * FROM ai_reports
        WHERE input_hash = @inputHash
        ORDER BY created_at DESC
        LIMIT 1
      `),

      // Security scanning
      insertSecurityScan: this.db.prepare(`
        INSERT INTO security_scans
          (id, scan_type, trigger_source, scanned_at, public_ip, files_scanned, lines_scanned, total_findings, security_score, scan_cursor, created_at)
        VALUES
          (@id, @scanType, @triggerSource, @scannedAt, @publicIp, @filesScanned, @linesScanned, @totalFindings, @securityScore, @scanCursor, @createdAt)
      `),

      insertSecurityFinding: this.db.prepare(`
        INSERT OR IGNORE INTO security_findings
          (id, scan_id, category, rule_id, rule_name, severity, source, session_id, message_id, line_number, masked_snippet, context, file_path, port, service, public_ip, reachable, remediation, bind_address, process_name, process_pid, tunnel_tool, tunnel_pid, tunnel_command, created_at)
        VALUES
          (@id, @scanId, @category, @ruleId, @ruleName, @severity, @source, @sessionId, @messageId, @lineNumber, @maskedSnippet, @context, @filePath, @port, @service, @publicIp, @reachable, @remediation, @bindAddress, @processName, @processPid, @tunnelTool, @tunnelPid, @tunnelCommand, @createdAt)
      `),

      getLatestSecurityScan: this.db.prepare(`
        SELECT * FROM security_scans ORDER BY created_at DESC LIMIT 1
      `),

      getLatestSecurityScanByType: this.db.prepare(`
        SELECT * FROM security_scans WHERE scan_type = @scanType ORDER BY created_at DESC LIMIT 1
      `),

      getSecurityFindings: this.db.prepare(`
        SELECT * FROM security_findings WHERE scan_id = @scanId ORDER BY severity ASC, created_at DESC
      `),

      getSecurityFindingsByCategory: this.db.prepare(`
        SELECT * FROM security_findings WHERE scan_id = @scanId AND category = @category ORDER BY severity ASC, created_at DESC
      `),

      getSecurityHistory: this.db.prepare(`
        SELECT * FROM security_scans WHERE created_at >= @since ORDER BY created_at DESC
      `),

      getSecurityHistoryByType: this.db.prepare(`
        SELECT * FROM security_scans WHERE scan_type = @scanType AND created_at >= @since ORDER BY created_at DESC
      `),

      getSecurityScanCursor: this.db.prepare(`
        SELECT scan_cursor FROM security_scans ORDER BY created_at DESC LIMIT 1
      `),

      getScoreTimeline: this.db.prepare(`
        SELECT
          date(scanned_at / 1000, 'unixepoch') AS date,
          security_score
        FROM security_scans
        WHERE created_at >= @since
        ORDER BY created_at ASC
      `),

      getScoreTimelineByType: this.db.prepare(`
        SELECT
          date(scanned_at / 1000, 'unixepoch') AS date,
          security_score
        FROM security_scans
        WHERE scan_type = @scanType AND created_at >= @since
        ORDER BY created_at ASC
      `),

      cleanupOldScans: this.db.prepare(`
        DELETE FROM security_scans WHERE id NOT IN (
          SELECT id FROM security_scans ORDER BY created_at DESC LIMIT @keepCount
        )
      `),

      cleanupOrphanedFindings: this.db.prepare(`
        DELETE FROM security_findings WHERE scan_id NOT IN (SELECT id FROM security_scans)
      `),

      // Rule management
      getAllRuleConfigs: this.db.prepare(`
        SELECT * FROM rule_configs ORDER BY rule_type, rule_id
      `),

      getRuleConfigsByType: this.db.prepare(`
        SELECT * FROM rule_configs WHERE rule_type = @ruleType
      `),

      upsertRuleConfig: this.db.prepare(`
        INSERT INTO rule_configs (rule_id, rule_type, enabled, updated_at)
        VALUES (@ruleId, @ruleType, @enabled, @updatedAt)
        ON CONFLICT(rule_id, rule_type) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
      `),

      getAllRuleOverrides: this.db.prepare(`
        SELECT * FROM rule_overrides ORDER BY rule_type, rule_id
      `),

      getRuleOverridesByType: this.db.prepare(`
        SELECT * FROM rule_overrides WHERE rule_type = @ruleType ORDER BY rule_id
      `),

      getRuleOverride: this.db.prepare(`
        SELECT * FROM rule_overrides WHERE rule_id = @ruleId AND rule_type = @ruleType
      `),

      upsertRuleOverride: this.db.prepare(`
        INSERT INTO rule_overrides (rule_id, rule_type, name, severity, description, definition, updated_at)
        VALUES (@ruleId, @ruleType, @name, @severity, @description, @definition, @updatedAt)
        ON CONFLICT(rule_id, rule_type) DO UPDATE SET
          name = excluded.name,
          severity = excluded.severity,
          description = excluded.description,
          definition = excluded.definition,
          updated_at = excluded.updated_at
      `),

      deleteRuleOverride: this.db.prepare(`
        DELETE FROM rule_overrides WHERE rule_id = @ruleId AND rule_type = @ruleType
      `),

      getAllCustomRules: this.db.prepare(`
        SELECT * FROM custom_rules ORDER BY rule_type, created_at DESC
      `),

      getCustomRulesByType: this.db.prepare(`
        SELECT * FROM custom_rules WHERE rule_type = @ruleType ORDER BY created_at DESC
      `),

      getCustomRule: this.db.prepare(`
        SELECT * FROM custom_rules WHERE id = @id
      `),

      insertCustomRule: this.db.prepare(`
        INSERT INTO custom_rules (id, rule_type, name, severity, description, definition, enabled, created_at, updated_at)
        VALUES (@id, @ruleType, @name, @severity, @description, @definition, @enabled, @createdAt, @updatedAt)
      `),

      updateCustomRule: this.db.prepare(`
        UPDATE custom_rules SET name = @name, severity = @severity, description = @description,
        definition = @definition, enabled = @enabled, updated_at = @updatedAt WHERE id = @id
      `),

      deleteCustomRule: this.db.prepare(`
        DELETE FROM custom_rules WHERE id = @id
      `),

      // Performance snapshots
      insertPerformanceSnapshot: this.db.prepare(`
        INSERT INTO performance_snapshots
          (id, snapshot_type, period_start, period_end, agent, model, metrics, perf_score, created_at)
        VALUES
          (@id, @snapshotType, @periodStart, @periodEnd, @agent, @model, @metrics, @perfScore, @createdAt)
      `),

      getLatestPerformanceSnapshot: this.db.prepare(`
        SELECT * FROM performance_snapshots WHERE snapshot_type = @snapshotType ORDER BY created_at DESC LIMIT 1
      `),

      getPerformanceHistory: this.db.prepare(`
        SELECT * FROM performance_snapshots WHERE snapshot_type = 'full' AND created_at >= @since ORDER BY created_at ASC
      `),

      getPerformanceScoreTimeline: this.db.prepare(`
        SELECT
          date(created_at / 1000, 'unixepoch') AS date,
          perf_score
        FROM performance_snapshots
        WHERE snapshot_type = 'full' AND created_at >= @since
        ORDER BY created_at ASC
      `),

      cleanupOldPerformanceSnapshots: this.db.prepare(`
        DELETE FROM performance_snapshots WHERE id NOT IN (
          SELECT id FROM performance_snapshots ORDER BY created_at DESC LIMIT @keepCount
        )
      `),

      insertFtsEvent: this.db.prepare(`
        INSERT INTO token_events_fts (event_id, session_id, plain_text)
        VALUES (@eventId, @sessionId, @plainText)
      `),
    };

    this._ingestMany = this.db.transaction((events) => {
      for (const event of events) {
        const result = this._stmts.insertEvent.run(event);
        if (result.changes > 0) {
          const plainText = extractPlainText(event.content);
          if (plainText) {
            this._stmts.insertFtsEvent.run({
              eventId: event.id,
              sessionId: event.sessionId,
              plainText,
            });
          }
        }
      }
    });
  }

  /**
   * Extract base64 images from content blocks, save to files,
   * and replace with file path references.
   */
  _extractImages(content, eventId) {
    if (!Array.isArray(content)) return content;

    const imagesDir = join(dirname(this.dbPath), 'images');
    let hasImages = false;

    const processed = content.map((block, i) => {
      if (block.type === 'image' && block.source?.type === 'base64' && block.source?.data) {
        if (!hasImages) {
          mkdirSync(imagesDir, { recursive: true });
          hasImages = true;
        }
        const ext = (block.source.media_type || 'image/png').split('/')[1] || 'png';
        const safeId = String(eventId).replace(/[^a-zA-Z0-9_:-]/g, '_');
        const fileName = `${safeId}_${i}.${ext}`;
        const filePath = join(imagesDir, fileName);
        if (!existsSync(filePath)) {
          writeFileSync(filePath, Buffer.from(block.source.data, 'base64'));
        }
        return { type: 'image', filePath: `/api/images/${fileName}` };
      }
      return block;
    });

    return processed;
  }

  ingestEvents(events) {
    if (!events || events.length === 0) return;

    const rows = events.map((e) => {
      const ts = e.timestamp instanceof Date ? e.timestamp.getTime() : e.timestamp;
      const dateStr = e.date || new Date(ts).toISOString().slice(0, 10);

      // Support plugin format where tokens are nested under `usage`
      const usage = e.usage || {};

      const eventId = e.id || uuidv4();

      // Extract base64 images to files before storing
      const content = Array.isArray(e.content)
        ? this._extractImages(e.content, eventId)
        : e.content;

      return {
        id: eventId,
        agent: e.agent ?? e.agentName,
        sourceMessageId: e.sourceMessageId || e.source_message_id || e.id || uuidv4(),
        sessionId: e.sessionId || e.session_id,
        projectPath: e.projectPath || e.project_path || e.project || null,
        projectName: e.projectName || e.project_name || e.project || null,
        timestamp: ts,
        role: e.role || null,
        model: e.model || null,
        inputTokens: e.inputTokens ?? e.input_tokens ?? usage.input_tokens ?? 0,
        outputTokens: e.outputTokens ?? e.output_tokens ?? usage.output_tokens ?? 0,
        cacheRead: e.cacheRead ?? e.cache_read ?? usage.cache_read_input_tokens ?? 0,
        cacheWrite: e.cacheWrite ?? e.cache_write ?? usage.cache_creation_input_tokens ?? 0,
        toolCalls: typeof e.toolCalls === 'string'
          ? e.toolCalls
          : JSON.stringify(e.toolCalls ?? e.tool_calls ?? []),
        contentLength: e.contentLength ?? e.content_length ?? 0,
        content: content != null
          ? (typeof content === 'string' ? content : JSON.stringify(content))
          : null,
        date: dateStr,
      };
    });

    this._ingestMany(rows);
  }

  _populateFtsIndex() {
    const batchSize = 1000;
    let offset = 0;
    const insertFts = this.db.prepare(`
      INSERT INTO token_events_fts (event_id, session_id, plain_text)
      VALUES (@eventId, @sessionId, @plainText)
    `);
    const batchInsert = this.db.transaction((rows) => {
      for (const row of rows) {
        insertFts.run(row);
      }
    });

    while (true) {
      const rows = this.db.prepare(`
        SELECT id, session_id, content FROM token_events
        WHERE content IS NOT NULL
        ORDER BY rowid ASC LIMIT ? OFFSET ?
      `).all(batchSize, offset);

      if (rows.length === 0) break;

      const ftsRows = rows
        .map(r => {
          const plainText = extractPlainText(r.content);
          return plainText ? { eventId: r.id, sessionId: r.session_id, plainText } : null;
        })
        .filter(Boolean);

      if (ftsRows.length > 0) {
        batchInsert(ftsRows);
      }

      offset += batchSize;
      if (rows.length < batchSize) break;
    }
  }

  queryByDateRange(start, end, agent) {
    const startMs = start instanceof Date ? start.getTime() : start;
    const endMs = end instanceof Date ? end.getTime() : end;

    const rows = agent
      ? this._stmts.queryByDateRangeAgent.all({ start: startMs, end: endMs, agent })
      : this._stmts.queryByDateRange.all({ start: startMs, end: endMs });

    return rows.map(this._parseEventRow);
  }

  _sanitizeFtsQuery(input) {
    const q = input.trim().replace(/"/g, '""');
    return q ? `"${q}"` : '';
  }

  listAgents() {
    return this._stmts.listDistinctAgents.all().map(r => r.agent);
  }

  listSessions({ start, end, agent, search, limit = 50, offset = 0 } = {}) {
    const startMs = start instanceof Date ? start.getTime() : (start || Date.now() - 90 * 24 * 3600_000);
    const endMs = end instanceof Date ? end.getTime() : (end || Date.now());
    const queryParams = { start: startMs, end: endMs, limit, offset };
    if (agent) queryParams.agent = agent;

    let rows;
    let total;

    if (search) {
      const searchLike = `%${search.toLowerCase()}%`;
      const ftsQuery = this._sanitizeFtsQuery(search);
      const searchParams = { ...queryParams, searchLike, ftsQuery };

      try {
        rows = agent
          ? this._stmts.listSessionsSearchAgent.all(searchParams)
          : this._stmts.listSessionsSearch.all(searchParams);
        total = (agent
          ? this._stmts.countSessionsSearchAgent.get(searchParams)
          : this._stmts.countSessionsSearch.get(searchParams)).total;
      } catch {
        rows = agent
          ? this._stmts.listSessionsAgent.all({ start: startMs, end: endMs, agent })
          : this._stmts.listSessions.all({ start: startMs, end: endMs });
        const q = search.toLowerCase();
        const sessions = rows
          .map(r => this._mapSessionSummaryRow(r))
          .filter(s => {
            const haystack = [s.sessionId, s.agent, s.projectName, s.projectPath]
              .filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(q);
          });
        return { total: sessions.length, sessions: sessions.slice(offset, offset + limit) };
      }
    } else {
      rows = agent
        ? this._stmts.listSessionsPagedAgent.all(queryParams)
        : this._stmts.listSessionsPaged.all(queryParams);
      total = (agent
        ? this._stmts.countDistinctSessionsAgent.get(queryParams)
        : this._stmts.countDistinctSessions.get(queryParams)).total;
    }

    return {
      total,
      sessions: rows.map(r => this._mapSessionSummaryRow(r)),
    };
  }

  queryBySession(sessionId) {
    const rows = this._stmts.queryBySession.all({ sessionId });
    return rows.map(this._parseEventRow);
  }

  getMessageById(id) {
    const row = this.db.prepare('SELECT * FROM token_events WHERE id = ?').get(id);
    return row ? this._parseEventRow(row) : null;
  }

  querySessionMessages(sessionId, { page = 1, pageSize = 20, search = '' } = {}) {
    const offset = (page - 1) * pageSize;

    if (search) {
      const ftsQuery = this._sanitizeFtsQuery(search);
      const like = `%${search}%`;
      const params = { sessionId, like, ftsQuery, limit: pageSize, offset };
      let total;
      let rows;

      try {
        total = this._stmts.countSessionMessagesSearch.get(params).total;
        if (total === 0) {
          return { messages: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
        }
        rows = this._stmts.querySessionMessagesSearch.all(params);
      } catch {
        total = this._stmts.countSessionMessagesMetaSearch.get(params).total;
        if (total === 0) {
          return { messages: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
        }
        rows = this._stmts.querySessionMessagesMetaSearch.all(params);
      }

      return {
        messages: rows.map(this._parseEventRow),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      };
    }

    const total = this._stmts.countSessionMessages.get({ sessionId }).total;
    const rows = this._stmts.querySessionMessagesPaged.all({ sessionId, limit: pageSize, offset });

    return {
      messages: rows.map(this._parseEventRow),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  getDailySummary(days = 30, agent) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const rows = agent
      ? this._stmts.dailySummaryAgent.all({ since: sinceStr, agent })
      : this._stmts.dailySummary.all({ since: sinceStr });

    return rows;
  }

  getMonthlySummary(months = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const sinceStr = since.toISOString().slice(0, 10);

    return this._stmts.monthlySummary.all({ since: sinceStr });
  }

  saveAnalysisBatch(aggregated) {
    const batchId = uuidv4();
    const now = Date.now();

    this.db.transaction(() => {
      this._stmts.insertAnalysisBatch.run({
        id: batchId,
        periodStart: aggregated.periodStart instanceof Date
          ? aggregated.periodStart.getTime()
          : aggregated.periodStart,
        periodEnd: aggregated.periodEnd instanceof Date
          ? aggregated.periodEnd.getTime()
          : aggregated.periodEnd,
        totalTokens: aggregated.totalTokens ?? 0,
        totalWasted: aggregated.totalWastedTokens ?? 0,
        healthScore: aggregated.healthScore != null
          ? JSON.stringify(aggregated.healthScore)
          : null,
        ruleCount: aggregated.byRule ? Object.keys(aggregated.byRule).length : 0,
        createdAt: now,
      });

      if (aggregated.byRule) {
        for (const [rule, results] of Object.entries(aggregated.byRule)) {
          const items = Array.isArray(results) ? results : [results];
          for (const result of items) {
            this._stmts.insertAnalysisResult.run({
              id: uuidv4(),
              batchId,
              sessionId: result.sessionId || null,
              agent: result.agent || null,
              rule,
              severity: result.severity || 'info',
              detail: result.detail != null ? JSON.stringify(result.detail) : null,
              evidence: JSON.stringify(result.evidence ?? []),
              suggestion: result.suggestion || null,
              estimatedWastedTokens: result.estimatedWastedTokens ?? 0,
              createdAt: now,
            });
          }
        }
      }
    })();

    return batchId;
  }

  getAnalysisResults(sessionId) {
    const rows = this._stmts.getAnalysisResults.all({ sessionId });
    return rows.map(row => {
      if (row.detail) { try { row.detail = JSON.parse(row.detail); } catch { /* keep */ } }
      if (row.evidence) { try { row.evidence = JSON.parse(row.evidence); } catch { /* keep */ } }
      return row;
    });
  }

  /**
   * Get aggregate stats (occurrences, estimatedWastedTokens) per rule across all stored results.
   * @returns {Map<string, {occurrences: number, estimatedWastedTokens: number}>}
   */
  getRuleStats() {
    const rows = this._stmts.getRuleStats.all();
    return new Map(rows.map(r => [r.rule, {
      occurrences: r.occurrences || 0,
      estimatedWastedTokens: r.estimated_wasted_tokens || 0,
    }]));
  }

  getLatestBatch() {
    const row = this._stmts.getLatestBatch.get() || null;
    if (row && row.health_score) {
      try { row.health_score = JSON.parse(row.health_score); } catch { /* keep as string */ }
    }
    return row;
  }

  getEventsByIds(eventIds) {
    if (!eventIds || eventIds.length === 0) return [];

    const placeholders = eventIds.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT * FROM token_events WHERE id IN (${placeholders})`
    );

    return stmt.all(...eventIds).map(this._parseEventRow);
  }

  getSessionTimeline(sessionId) {
    const rows = this._stmts.getSessionTimeline.all({ sessionId });
    return rows.map(this._parseEventRow);
  }

  getSyncMeta(key) {
    const row = this._stmts.getSyncMeta.get({ key });
    return row ? row.value : null;
  }

  setSyncMeta(key, value) {
    this._stmts.setSyncMeta.run({ key, value: String(value) });
  }

  saveAIReport(report) {
    const id = uuidv4();
    this._stmts.insertAIReport.run({
      id,
      period: report.period || null,
      agent: report.agent || null,
      inputHash: report.inputHash || report.input_hash,
      report: typeof report.report === 'string'
        ? report.report
        : JSON.stringify(report.report),
      modelUsed: report.modelUsed || report.model_used || null,
      createdAt: Date.now(),
    });
    return id;
  }

  getAIReport(inputHash) {
    const row = this._stmts.getAIReport.get({ inputHash });
    if (!row) return null;

    return {
      ...row,
      report: this._tryParseJSON(row.report),
    };
  }

  // --- Security scanning methods ---

  saveSecurityScan(scan) {
    const now = Date.now();
    this.db.transaction(() => {
      this._stmts.insertSecurityScan.run({
        id: scan.scanId,
        scanType: scan.scanType || 'full',
        triggerSource: scan.triggerSource || 'cli',
        scannedAt: scan.scannedAt instanceof Date ? scan.scannedAt.getTime() : (scan.scannedAt || now),
        publicIp: scan.publicIp || null,
        filesScanned: scan.filesScanned || 0,
        linesScanned: scan.linesScanned || 0,
        totalFindings: scan.totalFindings || 0,
        securityScore: scan.securityScore ? JSON.stringify(scan.securityScore) : null,
        scanCursor: scan.scanCursor ? JSON.stringify(scan.scanCursor) : null,
        createdAt: now,
      });

      if (scan.findings && scan.findings.length > 0) {
        for (const f of scan.findings) {
          this._stmts.insertSecurityFinding.run({
            id: f.id || uuidv4(),
            scanId: scan.scanId,
            category: f.category || 'leakage',
            ruleId: f.ruleId,
            ruleName: f.ruleName || f.ruleId,
            severity: f.severity,
            source: f.source || null,
            sessionId: f.sessionId || null,
            messageId: f.messageId || null,
            lineNumber: f.lineNumber || null,
            maskedSnippet: f.maskedSnippet || null,
            context: f.context || null,
            filePath: f.filePath || null,
            port: f.port || null,
            service: f.service || null,
            publicIp: f.publicIp || null,
            reachable: f.reachable != null ? (f.reachable ? 1 : 0) : null,
            remediation: f.remediation || null,
            bindAddress: f.bindAddress || null,
            processName: f.processName || f.process || null,
            processPid: f.processPid || f.pid || null,
            tunnelTool: f.tunnelTool || null,
            tunnelPid: f.tunnelPid || null,
            tunnelCommand: f.tunnelCommand || null,
            createdAt: now,
          });
        }
      }
    })();

    // Cleanup old scans (keep 30)
    this._stmts.cleanupOldScans.run({ keepCount: 30 });
    this._stmts.cleanupOrphanedFindings.run();

    return scan.scanId;
  }

  getLatestSecurityScan(scanType) {
    const row = scanType
      ? this._stmts.getLatestSecurityScanByType.get({ scanType })
      : this._stmts.getLatestSecurityScan.get();
    if (!row) return null;
    return this._parseSecurityScanRow(row);
  }

  getSecurityFindings(scanId, options = {}) {
    const { category, page = 1, pageSize = 50 } = options;
    let rows;
    if (category) {
      rows = this._stmts.getSecurityFindingsByCategory.all({ scanId, category });
    } else {
      rows = this._stmts.getSecurityFindings.all({ scanId });
    }

    // Apply severity filter
    if (options.severity) {
      rows = rows.filter(r => r.severity === options.severity);
    }
    // Apply ruleId filter
    if (options.ruleId) {
      rows = rows.filter(r => r.rule_id === options.ruleId);
    }

    const total = rows.length;
    const offset = (page - 1) * pageSize;
    const paged = rows.slice(offset, offset + pageSize);

    return {
      findings: paged.map(this._parseSecurityFindingRow),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  getSecurityHistory(days = 30, scanType) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = scanType
      ? this._stmts.getSecurityHistoryByType.all({ since, scanType })
      : this._stmts.getSecurityHistory.all({ since });
    return rows.map(r => this._parseSecurityScanRow(r));
  }

  getSecurityScanCursor() {
    const row = this._stmts.getSecurityScanCursor.get();
    if (!row || !row.scan_cursor) return null;
    try { return JSON.parse(row.scan_cursor); } catch { return null; }
  }

  /**
   * Get score timeline for sparkline display.
   * @param {number} [days=30]
   * @returns {Array<{date: string, score: number}>}
   */
  getScoreTimeline(days = 30, scanType) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = scanType
      ? this._stmts.getScoreTimelineByType.all({ since, scanType })
      : this._stmts.getScoreTimeline.all({ since });
    return rows
      .map(row => {
        const parsed = this._tryParseJSON(row.security_score);
        return parsed && typeof parsed.score === 'number'
          ? { date: row.date, score: parsed.score }
          : null;
      })
      .filter(Boolean);
  }

  _parseSecurityScanRow(row) {
    return {
      id: row.id,
      scanType: row.scan_type,
      triggerSource: row.trigger_source,
      scannedAt: row.scanned_at,
      publicIp: row.public_ip,
      filesScanned: row.files_scanned,
      linesScanned: row.lines_scanned,
      totalFindings: row.total_findings,
      securityScore: row.security_score ? this._tryParseJSON(row.security_score) : null,
      scanCursor: row.scan_cursor ? this._tryParseJSON(row.scan_cursor) : null,
      createdAt: row.created_at,
    };
  }

  _parseSecurityFindingRow(row) {
    return {
      id: row.id,
      scanId: row.scan_id,
      category: row.category,
      ruleId: row.rule_id,
      ruleName: row.rule_name,
      severity: row.severity,
      source: row.source,
      sessionId: row.session_id,
      messageId: row.message_id,
      lineNumber: row.line_number,
      maskedSnippet: row.masked_snippet,
      context: row.context,
      filePath: row.file_path,
      port: row.port,
      service: row.service,
      publicIp: row.public_ip,
      reachable: row.reachable != null ? !!row.reachable : null,
      remediation: row.remediation,
      bindAddress: row.bind_address,
      processName: row.process_name,
      processPid: row.process_pid,
      tunnelTool: row.tunnel_tool,
      tunnelPid: row.tunnel_pid,
      tunnelCommand: row.tunnel_command,
      createdAt: row.created_at,
    };
  }

  _mapSessionSummaryRow(r) {
    return {
      sessionId: r.session_id,
      agent: r.agent,
      projectName: r.project_name,
      projectPath: r.project_path,
      startTime: r.start_time,
      endTime: r.end_time,
      eventCount: r.event_count,
      totalInput: r.total_input,
      totalOutput: r.total_output,
      totalTokens: r.total_tokens,
      totalCacheRead: r.total_cache_read,
      totalCacheWrite: r.total_cache_write,
      models: r.models ? r.models.split(',') : [],
      title: extractSessionTitle(r.first_content),
    };
  }

  /**
   * Get session titles for a list of session IDs.
   * @param {string[]} sessionIds
   * @returns {Object<string, string|null>} Map of sessionId → title
   */
  getSessionTitles(sessionIds) {
    if (!sessionIds || sessionIds.length === 0) return {};
    // SQLite supports at most 999 bind parameters; chunk to avoid exceeding the limit
    const CHUNK_SIZE = 999;
    const result = {};
    for (let i = 0; i < sessionIds.length; i += CHUNK_SIZE) {
      const chunk = sessionIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db.prepare(`
        SELECT session_id, COALESCE(
          (SELECT SUBSTR(content, 1, 500) FROM token_events t2
           WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.role = 'user'
           ORDER BY t2.timestamp ASC LIMIT 1),
          (SELECT SUBSTR(content, 1, 500) FROM token_events t2
           WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL AND t2.content LIKE '%"type":"text"%'
           ORDER BY t2.timestamp ASC LIMIT 1),
          (SELECT SUBSTR(content, 1, 500) FROM token_events t2
           WHERE t2.session_id = token_events.session_id AND t2.content IS NOT NULL
           ORDER BY t2.timestamp ASC LIMIT 1)
        ) AS first_content
        FROM token_events
        WHERE session_id IN (${placeholders})
        GROUP BY session_id
      `).all(...chunk);
      for (const r of rows) {
        result[r.session_id] = extractSessionTitle(r.first_content);
      }
    }
    return result;
  }

  // --- Rule management methods ---

  getRuleConfigs(ruleType) {
    const rows = ruleType
      ? this._stmts.getRuleConfigsByType.all({ ruleType })
      : this._stmts.getAllRuleConfigs.all();
    return rows.map(row => ({
      ruleId: row.rule_id,
      ruleType: row.rule_type,
      enabled: !!row.enabled,
      updatedAt: row.updated_at,
    }));
  }

  setRuleConfig(ruleId, ruleType, enabled) {
    this._stmts.upsertRuleConfig.run({
      ruleId,
      ruleType,
      enabled: enabled ? 1 : 0,
      updatedAt: Date.now(),
    });
  }

  getRuleOverrides(ruleType) {
    const rows = ruleType
      ? this._stmts.getRuleOverridesByType.all({ ruleType })
      : this._stmts.getAllRuleOverrides.all();
    return rows.map(row => ({
      ruleId: row.rule_id,
      ruleType: row.rule_type,
      name: row.name || null,
      severity: row.severity || null,
      description: row.description || '',
      definition: this._tryParseJSON(row.definition),
      updatedAt: row.updated_at,
    }));
  }

  getRuleOverride(ruleId, ruleType) {
    const row = this._stmts.getRuleOverride.get({ ruleId, ruleType });
    if (!row) return null;
    return {
      ruleId: row.rule_id,
      ruleType: row.rule_type,
      name: row.name || null,
      severity: row.severity || null,
      description: row.description || '',
      definition: this._tryParseJSON(row.definition),
      updatedAt: row.updated_at,
    };
  }

  setRuleOverride(ruleId, ruleType, override) {
    this._stmts.upsertRuleOverride.run({
      ruleId,
      ruleType,
      name: override.name ?? null,
      severity: override.severity ?? null,
      description: override.description ?? '',
      definition: override.definition != null
        ? (typeof override.definition === 'string' ? override.definition : JSON.stringify(override.definition))
        : null,
      updatedAt: Date.now(),
    });
  }

  deleteRuleOverride(ruleId, ruleType) {
    const result = this._stmts.deleteRuleOverride.run({ ruleId, ruleType });
    return result.changes > 0;
  }

  getCustomRules(ruleType) {
    const rows = ruleType
      ? this._stmts.getCustomRulesByType.all({ ruleType })
      : this._stmts.getAllCustomRules.all();
    return rows.map(this._parseCustomRuleRow.bind(this));
  }

  getCustomRule(id) {
    const row = this._stmts.getCustomRule.get({ id });
    return row ? this._parseCustomRuleRow(row) : null;
  }

  saveCustomRule(rule) {
    const now = Date.now();
    const id = rule.id || `C${rule.ruleType === 'security' ? 'S' : 'R'}_${uuidv4().slice(0, 8)}`;
    this._stmts.insertCustomRule.run({
      id,
      ruleType: rule.ruleType,
      name: rule.name,
      severity: rule.severity,
      description: rule.description || '',
      definition: typeof rule.definition === 'string' ? rule.definition : JSON.stringify(rule.definition),
      enabled: rule.enabled !== false ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  updateCustomRule(id, updates) {
    const existing = this.getCustomRule(id);
    if (!existing) return false;
    this._stmts.updateCustomRule.run({
      id,
      name: updates.name ?? existing.name,
      severity: updates.severity ?? existing.severity,
      description: updates.description ?? existing.description,
      definition: updates.definition != null
        ? (typeof updates.definition === 'string' ? updates.definition : JSON.stringify(updates.definition))
        : JSON.stringify(existing.definition),
      enabled: updates.enabled != null ? (updates.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      updatedAt: Date.now(),
    });
    return true;
  }

  deleteCustomRule(id) {
    const result = this._stmts.deleteCustomRule.run({ id });
    return result.changes > 0;
  }

  _parseCustomRuleRow(row) {
    return {
      id: row.id,
      ruleType: row.rule_type,
      name: row.name,
      severity: row.severity,
      description: row.description,
      definition: this._tryParseJSON(row.definition),
      enabled: !!row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- Performance snapshot methods ---

  savePerformanceSnapshot(snapshot) {
    const now = Date.now();
    const id = snapshot.id || `perf_${uuidv4().slice(0, 12)}`;
    this._stmts.insertPerformanceSnapshot.run({
      id,
      snapshotType: snapshot.snapshotType || 'full',
      periodStart: snapshot.periodStart instanceof Date ? snapshot.periodStart.getTime() : snapshot.periodStart,
      periodEnd: snapshot.periodEnd instanceof Date ? snapshot.periodEnd.getTime() : snapshot.periodEnd,
      agent: snapshot.agent || null,
      model: snapshot.model || null,
      metrics: typeof snapshot.metrics === 'string' ? snapshot.metrics : JSON.stringify(snapshot.metrics),
      perfScore: snapshot.score ? JSON.stringify(snapshot.score) : null,
      createdAt: now,
    });

    this._stmts.cleanupOldPerformanceSnapshots.run({ keepCount: 50 });
    return id;
  }

  getLatestPerformanceSnapshot(snapshotType = 'full') {
    const row = this._stmts.getLatestPerformanceSnapshot.get({ snapshotType });
    if (!row) return null;
    return this._parsePerformanceSnapshotRow(row);
  }

  getPerformanceHistory(days = 30) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this._stmts.getPerformanceHistory.all({ since });
    return rows.map(r => this._parsePerformanceSnapshotRow(r));
  }

  getPerformanceScoreTimeline(days = 30) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = this._stmts.getPerformanceScoreTimeline.all({ since });
    return rows
      .map(row => {
        const parsed = this._tryParseJSON(row.perf_score);
        return parsed && typeof parsed.score === 'number'
          ? { date: row.date, score: parsed.score }
          : null;
      })
      .filter(Boolean);
  }

  _parsePerformanceSnapshotRow(row) {
    return {
      id: row.id,
      snapshotType: row.snapshot_type,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      agent: row.agent,
      model: row.model,
      metrics: this._tryParseJSON(row.metrics),
      score: this._tryParseJSON(row.perf_score),
      createdAt: row.created_at,
    };
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  _parseEventRow(row) {
    return {
      id: row.id,
      agent: row.agent,
      sourceMessageId: row.source_message_id,
      sessionId: row.session_id,
      projectPath: row.project_path,
      projectName: row.project_name,
      timestamp: row.timestamp,
      role: row.role,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
      toolCalls: (() => {
        try { return JSON.parse(row.tool_calls); } catch { return []; }
      })(),
      contentLength: row.content_length,
      content: (() => {
        if (!row.content) return null;
        try { return JSON.parse(row.content); } catch { return row.content; }
      })(),
      date: row.date,
    };
  }

  _tryParseJSON(str) {
    if (typeof str !== 'string') return str;
    try { return JSON.parse(str); } catch { return str; }
  }
}
