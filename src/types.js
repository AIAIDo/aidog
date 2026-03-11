/**
 * Core type definitions for aidog — ChatOps Toolkit.
 *
 * Pure JS with JSDoc typedefs. All structures are plain objects;
 * factory helpers enforce defaults so callers never have to remember every field.
 *
 * @module types
 */

// ---------------------------------------------------------------------------
// Primitive-ish enums (just string unions in JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {"user" | "assistant"} Role
 */

/**
 * @typedef {"critical" | "high" | "medium" | "low"} Severity
 */

/**
 * @typedef {"A" | "B" | "C" | "D" | "F"} Grade
 */

/**
 * @typedef {"improving" | "stable" | "declining"} Trend
 */

/**
 * @typedef {Object} ScoreTrendPoint
 * @property {string} date  - ISO date string (YYYY-MM-DD)
 * @property {number} score - Security score at that point
 */

/**
 * @typedef {Object} ScoreTrend
 * @property {Trend}             direction
 * @property {number}            delta    - Change from 7 days ago (or earliest)
 * @property {ScoreTrendPoint[]} history  - Data points for sparkline
 */

/**
 * @typedef {Object} SecurityHealthScore
 * @property {number} score                         - 0-100
 * @property {Grade}  grade
 * @property {string} label                         - Chinese label
 * @property {{ leakage: number, exposure: number }} breakdown
 * @property {ScoreTrend} [trend]
 */

/**
 * @typedef {"tool_use" | "tool_result"} ToolCallType
 */

// ---------------------------------------------------------------------------
// ToolCall
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ToolCall
 * @property {ToolCallType} type
 * @property {string}       name
 * @property {number}       inputSize
 * @property {number}       outputSize
 * @property {number}       [schemaTokens]
 */

// ---------------------------------------------------------------------------
// TokenEvent — the normalised event produced by every adapter
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TokenEvent
 * @property {string}     id               - "${agentName}:${sourceMessageId}"
 * @property {string}     agentName
 * @property {string}     sourceMessageId
 * @property {string}     sessionId
 * @property {string}     projectPath
 * @property {string}     projectName
 * @property {Date}       timestamp
 * @property {Role}       role
 * @property {string}     model
 * @property {number}     inputTokens
 * @property {number}     outputTokens
 * @property {number}     cacheReadTokens
 * @property {number}     cacheWriteTokens
 * @property {ToolCall[]} toolCalls
 * @property {number}     contentLength
 * @property {*}          [raw]
 */

// ---------------------------------------------------------------------------
// EvidenceItem — attached to each triggered rule result
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EvidenceItem
 * @property {string}   eventId
 * @property {string}   sessionId
 * @property {number}   turnIndex
 * @property {number}   timestamp
 * @property {number}   inputTokens
 * @property {number}   outputTokens
 * @property {number}   wastedTokens
 * @property {string}   reason
 * @property {string[]} [toolCalls]
 */

// ---------------------------------------------------------------------------
// RuleResult
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} RuleResult
 * @property {string}               ruleId
 * @property {Severity}             severity
 * @property {boolean}              triggered
 * @property {number}               occurrences
 * @property {Record<string, any>}  detail
 * @property {number}               estimatedWastedTokens
 * @property {EvidenceItem[]}       evidence
 */

// ---------------------------------------------------------------------------
// HealthScore
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} HealthScoreBreakdown
 * @property {number} wasteRatio
 * @property {number} cacheEfficiency
 * @property {number} modelFit
 * @property {number} sessionHygiene
 * @property {number} toolEfficiency
 */

/**
 * @typedef {Object} HealthScore
 * @property {number}               score
 * @property {Grade}                grade
 * @property {string}               label
 * @property {HealthScoreBreakdown} breakdown
 * @property {Trend}                trend
 * @property {number}               [previousScore]
 */

// ---------------------------------------------------------------------------
// Action & Recommendation — AI-generated suggestions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Action
 * @property {string} description
 * @property {string} command       - Suggested CLI command or config change
 * @property {string} impact        - Expected improvement description
 */

/**
 * @typedef {Object} Recommendation
 * @property {string}   ruleId
 * @property {Severity} severity
 * @property {string}   title
 * @property {string}   explanation
 * @property {Action[]} actions
 */

// ---------------------------------------------------------------------------
// AnalysisReport — top-level output of an analysis run
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AnalysisReport
 * @property {string}             id
 * @property {Date}               generatedAt
 * @property {string}             projectPath
 * @property {{ from: Date, to: Date }} period
 * @property {HealthScore}        healthScore
 * @property {RuleResult[]}       ruleResults
 * @property {Recommendation[]}   recommendations
 * @property {{ totalInput: number, totalOutput: number, totalCacheRead: number, totalCacheWrite: number, eventCount: number }} tokenTotals
 */

// ---------------------------------------------------------------------------
// DailySummary
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DailySummary
 * @property {string} date          - ISO date string (YYYY-MM-DD)
 * @property {string} projectPath
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheWriteTokens
 * @property {number} eventCount
 * @property {number} sessionCount
 * @property {number} estimatedCostUsd
 * @property {HealthScore} [healthScore]
 */

// ---------------------------------------------------------------------------
// MonthlySummary
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MonthlySummary
 * @property {string} month         - "YYYY-MM"
 * @property {string} projectPath
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheWriteTokens
 * @property {number} eventCount
 * @property {number} sessionCount
 * @property {number} estimatedCostUsd
 * @property {DailySummary[]} dailyBreakdown
 * @property {HealthScore} [healthScore]
 */

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a fully-populated TokenEvent with sensible defaults.
 *
 * @param {Partial<TokenEvent> & { agentName: string, sourceMessageId: string }} data
 * @returns {TokenEvent}
 */
export function createTokenEvent(data) {
  const agentName = data.agentName;
  const sourceMessageId = data.sourceMessageId;

  return {
    id: `${agentName}:${sourceMessageId}`,
    agentName,
    sourceMessageId,
    sessionId: data.sessionId ?? '',
    projectPath: data.projectPath ?? '',
    projectName: data.projectName ?? '',
    timestamp: data.timestamp ?? new Date(),
    role: data.role ?? 'assistant',
    model: data.model ?? '',
    inputTokens: data.inputTokens ?? 0,
    outputTokens: data.outputTokens ?? 0,
    cacheReadTokens: data.cacheReadTokens ?? 0,
    cacheWriteTokens: data.cacheWriteTokens ?? 0,
    toolCalls: data.toolCalls ?? [],
    contentLength: data.contentLength ?? 0,
    ...(data.raw !== undefined ? { raw: data.raw } : {}),
  };
}

/**
 * Create a fully-populated RuleResult with sensible defaults.
 *
 * @param {Partial<RuleResult> & { ruleId: string }} data
 * @returns {RuleResult}
 */
export function createRuleResult(data) {
  return {
    ruleId: data.ruleId,
    severity: data.severity ?? 'low',
    triggered: data.triggered ?? false,
    occurrences: data.occurrences ?? 0,
    detail: data.detail ?? {},
    estimatedWastedTokens: data.estimatedWastedTokens ?? 0,
    evidence: data.evidence ?? [],
  };
}
