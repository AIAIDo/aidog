/**
 * Security module type definitions for aidog.
 * @module security/types
 */

/** @typedef {"critical" | "high" | "medium" | "low"} SecuritySeverity */
/** @typedef {"leakage" | "exposure"} SecurityCategory */

/**
 * @typedef {Object} SensitiveRule
 * @property {string} id
 * @property {string} name
 * @property {SecuritySeverity} severity
 * @property {SecurityCategory} category
 * @property {string} description
 * @property {RegExp[]} patterns
 * @property {(match: string) => string} mask
 * @property {boolean} [builtIn]
 */

/**
 * @typedef {Object} LeakageFinding
 * @property {string} ruleId
 * @property {string} ruleName
 * @property {SecuritySeverity} severity
 * @property {string} source - "user_message" | "tool_input" | "tool_output"
 * @property {string} sessionId
 * @property {string} messageId
 * @property {number} lineNumber
 * @property {string} maskedSnippet
 * @property {string} context
 * @property {string} filePath
 * @property {number} [createdAt]
 */

/**
 * @typedef {Object} LeakageScanResult
 * @property {string} scanId
 * @property {Date} scannedAt
 * @property {number} filesScanned
 * @property {number} linesScanned
 * @property {number} totalFindings
 * @property {LeakageFinding[]} findings
 * @property {Record<string, number>} findingsByRule
 * @property {Record<string, number>} findingsBySeverity
 */

/**
 * @typedef {Object} ExposureFinding
 * @property {string} ruleId
 * @property {string} ruleName
 * @property {SecuritySeverity} severity
 * @property {number} port
 * @property {string} service
 * @property {string} publicIp
 * @property {boolean} reachable
 * @property {string} remediation
 */

/**
 * @typedef {Object} TunnelFinding
 * @property {string} tool
 * @property {number} pid
 * @property {string} command
 * @property {SecuritySeverity} severity
 */

/**
 * @typedef {Object} ExposureScanResult
 * @property {string} scanId
 * @property {Date} scannedAt
 * @property {string|null} publicIp
 * @property {ExposureFinding[]} portFindings
 * @property {TunnelFinding[]} tunnelFindings
 * @property {number} totalFindings
 * @property {string} [note]
 * @property {boolean} [proxyDetected]
 * @property {boolean} [proxySuspected]
 * @property {string[]} [proxyReasons]
 */

/**
 * @typedef {Object} SecurityHealthScore
 * @property {number} score
 * @property {string} grade
 * @property {string} label
 * @property {{ leakage: number, exposure: number }} breakdown
 */

/**
 * @typedef {Object} SecurityScanResult
 * @property {string} scanId
 * @property {Date} scannedAt
 * @property {LeakageScanResult|null} leakage
 * @property {ExposureScanResult|null} exposure
 * @property {SecurityHealthScore} securityScore
 */

/**
 * @typedef {Object} ScanCursor
 * @property {string} filePath
 * @property {number} lastOffset
 * @property {number} lastMtime
 */
