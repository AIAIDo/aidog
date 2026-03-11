CREATE TABLE IF NOT EXISTS token_events (
  id              TEXT PRIMARY KEY,
  agent           TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  project_path    TEXT,
  project_name    TEXT,
  timestamp       INTEGER NOT NULL,
  role            TEXT,
  model           TEXT,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  cache_read      INTEGER DEFAULT 0,
  cache_write     INTEGER DEFAULT 0,
  tool_calls      TEXT DEFAULT '[]',
  content_length  INTEGER DEFAULT 0,
  content         TEXT,
  date            TEXT
);

CREATE INDEX IF NOT EXISTS idx_timestamp   ON token_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_session     ON token_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_time ON token_events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_date        ON token_events(date);
CREATE INDEX IF NOT EXISTS idx_agent_date  ON token_events(agent, date);
CREATE INDEX IF NOT EXISTS idx_agent_timestamp ON token_events(agent, timestamp);
CREATE INDEX IF NOT EXISTS idx_model       ON token_events(model);

CREATE TABLE IF NOT EXISTS analysis_results (
  id                      TEXT PRIMARY KEY,
  batch_id                TEXT NOT NULL,
  session_id              TEXT,
  agent                   TEXT,
  rule                    TEXT NOT NULL,
  severity                TEXT NOT NULL,
  detail                  TEXT,
  evidence                TEXT DEFAULT '[]',
  suggestion              TEXT,
  estimated_wasted_tokens INTEGER DEFAULT 0,
  created_at              INTEGER
);

CREATE INDEX IF NOT EXISTS idx_analysis_rule ON analysis_results(rule);
CREATE INDEX IF NOT EXISTS idx_analysis_session ON analysis_results(session_id);
CREATE INDEX IF NOT EXISTS idx_analysis_batch ON analysis_results(batch_id);

CREATE TABLE IF NOT EXISTS analysis_batches (
  id              TEXT PRIMARY KEY,
  period_start    INTEGER NOT NULL,
  period_end      INTEGER NOT NULL,
  total_tokens    INTEGER DEFAULT 0,
  total_wasted    INTEGER DEFAULT 0,
  health_score    TEXT,
  rule_count      INTEGER DEFAULT 0,
  created_at      INTEGER
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ai_reports (
  id          TEXT PRIMARY KEY,
  period      TEXT,
  agent       TEXT,
  input_hash  TEXT,
  report      TEXT,
  model_used  TEXT,
  created_at  INTEGER
);

CREATE TABLE IF NOT EXISTS security_scans (
  id              TEXT PRIMARY KEY,
  scan_type       TEXT NOT NULL,
  trigger_source  TEXT DEFAULT 'cli',
  scanned_at      INTEGER NOT NULL,
  public_ip       TEXT,
  files_scanned   INTEGER DEFAULT 0,
  lines_scanned   INTEGER DEFAULT 0,
  total_findings  INTEGER DEFAULT 0,
  security_score  TEXT,
  scan_cursor     TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS security_findings (
  id              TEXT PRIMARY KEY,
  scan_id         TEXT NOT NULL,
  category        TEXT NOT NULL,
  rule_id         TEXT NOT NULL,
  rule_name       TEXT NOT NULL,
  severity        TEXT NOT NULL,
  source          TEXT,
  session_id      TEXT,
  message_id      TEXT,
  line_number     INTEGER,
  masked_snippet  TEXT,
  context         TEXT,
  file_path       TEXT,
  port            INTEGER,
  service         TEXT,
  public_ip       TEXT,
  reachable       INTEGER,
  remediation     TEXT,
  bind_address    TEXT,
  process_name    TEXT,
  process_pid     INTEGER,
  tunnel_tool     TEXT,
  tunnel_pid      INTEGER,
  tunnel_command  TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES security_scans(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sf_dedup
  ON security_findings(file_path, line_number, rule_id)
  WHERE category = 'leakage';

CREATE INDEX IF NOT EXISTS idx_sf_scan ON security_findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_sf_rule ON security_findings(rule_id);
CREATE INDEX IF NOT EXISTS idx_sf_severity ON security_findings(severity);

CREATE TABLE IF NOT EXISTS rule_configs (
  rule_id     TEXT NOT NULL,
  rule_type   TEXT NOT NULL,
  enabled     INTEGER DEFAULT 1,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (rule_id, rule_type)
);

CREATE TABLE IF NOT EXISTS rule_overrides (
  rule_id     TEXT NOT NULL,
  rule_type   TEXT NOT NULL,
  name        TEXT,
  severity    TEXT,
  description TEXT,
  definition  TEXT,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (rule_id, rule_type)
);

CREATE TABLE IF NOT EXISTS custom_rules (
  id          TEXT PRIMARY KEY,
  rule_type   TEXT NOT NULL,
  name        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition  TEXT NOT NULL,
  enabled     INTEGER DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custom_rules_type ON custom_rules(rule_type);

CREATE TABLE IF NOT EXISTS performance_snapshots (
  id              TEXT PRIMARY KEY,
  snapshot_type   TEXT NOT NULL,
  period_start    INTEGER NOT NULL,
  period_end      INTEGER NOT NULL,
  agent           TEXT,
  model           TEXT,
  metrics         TEXT NOT NULL,
  perf_score      TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_perf_snap_type ON performance_snapshots(snapshot_type);
CREATE INDEX IF NOT EXISTS idx_perf_snap_created ON performance_snapshots(created_at);
