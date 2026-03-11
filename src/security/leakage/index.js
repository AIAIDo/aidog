import { readFileSync, statSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getAllRules, builtInRules } from './rules/index.js';

const ORIGINAL_BUILT_IN_RULE_SNAPSHOTS = new Map(
  builtInRules.map(rule => [rule.id, {
    name: rule.name,
    severity: rule.severity,
    patterns: rule.patterns.map(p => new RegExp(p.source, p.flags)),
    mask: rule.mask,
    validate: rule.validate,
    description: rule.description,
  }])
);

/**
 * LeakageScanner — scans JSONL conversation files for sensitive information.
 */
export class LeakageScanner {
  /** @type {import('../types.js').SensitiveRule[]} */
  #rules = [];
  /** @type {Set<string>} */
  #disabledRules = new Set();
  /** @type {Map<string, object>} Original built-in rule snapshots */
  #originalRules = new Map();

  constructor({ customRules } = {}) {
    this.#rules = getAllRules();
    if (customRules && customRules.length > 0) {
      this.#rules.push(...customRules);
    }
    // Snapshot built-in originals for restore
    for (const rule of this.#rules) {
      if (rule.builtIn !== false) {
        const original = ORIGINAL_BUILT_IN_RULE_SNAPSHOTS.get(rule.id);
        if (!original) continue;
        this.#originalRules.set(rule.id, original);
        rule.name = original.name;
        rule.severity = original.severity;
        rule.patterns = original.patterns.map(p => new RegExp(p.source, p.flags));
        rule.mask = original.mask;
        rule.validate = original.validate;
        rule.description = original.description;
      }
    }
  }

  /**
   * Override built-in rules.
   * Restores originals first so this can be called multiple times safely.
   * @param {{ [ruleId: string]: { name?: string, severity?: string, patterns?: string[], description?: string, mask?: { prefix: number, suffix: number }, hasChecksum?: boolean } }} overrides
   */
  applyRuleOverrides(overrides) {
    for (const rule of this.#rules) {
      const orig = this.#originalRules.get(rule.id);
      if (orig) {
        rule.name = orig.name;
        rule.severity = orig.severity;
        rule.patterns = orig.patterns.map(p => new RegExp(p.source, p.flags));
        rule.mask = orig.mask;
        rule.validate = orig.validate;
        rule.description = orig.description;
      }

      const override = overrides[rule.id];
      if (!override) continue;

      // Apply overrides
      if (override.name) {
        rule.name = override.name;
      }
      if (override.severity) {
        rule.severity = override.severity;
      }
      if (override.patterns && override.patterns.length > 0) {
        rule.patterns = override.patterns.map(p => new RegExp(p, 'g'));
      }
      if (override.description) {
        rule.description = override.description;
      }
      if (override.mask) {
        const { prefix, suffix } = override.mask;
        rule.mask = (match) => {
          if (match.length <= prefix + suffix) return '****';
          return match.slice(0, prefix) + '****' + match.slice(-suffix);
        };
      }
      if (override.hasChecksum === false) {
        rule.validate = undefined;
      }
    }
  }

  addRule(rule) {
    this.#rules.push(rule);
  }

  removeRule(ruleId) {
    this.#rules = this.#rules.filter(r => r.id !== ruleId);
  }

  setDisabledRules(disabledSet) {
    this.#disabledRules = disabledSet;
  }

  /**
   * Scan multiple JSONL files for sensitive information.
   * @param {string[]} filePaths
   * @param {Object} [options]
   * @param {string[]} [options.ruleIds]
   * @param {import('../types.js').ScanCursor[]} [options.cursors]
   * @returns {Promise<import('../types.js').LeakageScanResult>}
   */
  async scan(filePaths, options = {}) {
    const scanId = options.scanId || `sec_${uuidv4().slice(0, 12)}`;
    const enabledRules = this.#rules.filter(r => !this.#disabledRules.has(r.id));
    const activeRules = options.ruleIds
      ? enabledRules.filter(r => options.ruleIds.includes(r.id))
      : enabledRules;

    const findings = [];
    let filesScanned = 0;
    let linesScanned = 0;
    const cursorMap = new Map((options.cursors || []).map(c => [c.filePath, c]));

    for (const filePath of filePaths) {
      try {
        const stat = statSync(filePath);
        const cursor = cursorMap.get(filePath);

        // Skip if file hasn't changed
        if (cursor && stat.mtimeMs <= cursor.lastMtime && stat.size <= cursor.lastOffset) {
          continue;
        }

        const startOffset = cursor ? cursor.lastOffset : 0;
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        filesScanned++;
        let byteOffset = 0;

        for (let i = 0; i < lines.length; i++) {
          const rawLine = lines[i];
          const lineBytes = Buffer.byteLength(rawLine, 'utf-8') + 1; // include '\n'
          if (byteOffset < startOffset) {
            byteOffset += lineBytes;
            continue;
          }

          const line = rawLine.trim();
          if (!line) {
            byteOffset += lineBytes;
            continue;
          }

          linesScanned++;

          try {
            const record = JSON.parse(line);
            const recordFindings = this.#scanRecord(record, {
              filePath,
              lineNumber: i + 1,
              activeRules,
            });
            findings.push(...recordFindings);
          } catch {
            // Skip malformed JSON lines
          }

          byteOffset += lineBytes;
        }
      } catch (err) {
        console.warn(`[security] Failed to scan ${filePath}: ${err.message}`);
      }
    }

    const findingsByRule = {};
    const findingsBySeverity = {};
    for (const f of findings) {
      findingsByRule[f.ruleId] = (findingsByRule[f.ruleId] || 0) + 1;
      findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] || 0) + 1;
    }

    return {
      scanId,
      scannedAt: new Date(),
      filesScanned,
      linesScanned,
      totalFindings: findings.length,
      findings,
      findingsByRule,
      findingsBySeverity,
    };
  }

  /**
   * Scan a single JSONL record for sensitive info.
   * @param {Object} record
   * @param {Object} context
   * @returns {import('../types.js').LeakageFinding[]}
   */
  #scanRecord(record, { filePath, lineNumber, activeRules }) {
    const findings = [];
    const sessionId = record.sessionId || record.session_id || record.id || '';
    const messageId = record.message?.id || record.id || '';
    const createdAt = this.#extractRecordTimestamp(record);

    // Extract scannable text segments
    const segments = this.#extractTextSegments(record);

    for (const { text, source } of segments) {
      for (const rule of activeRules) {
        const matches = this.#findMatches(text, rule);
        for (const match of matches) {
          findings.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            source,
            sessionId,
            messageId,
            lineNumber,
            maskedSnippet: rule.mask(match),
            context: this.#buildMaskedContext(text, match, rule),
            filePath,
            createdAt,
          });
        }
      }
    }

    return findings;
  }

  /**
   * Best-effort extraction of the source event timestamp so score decay can
   * reflect when the sensitive content was originally produced.
   * @param {Object} record
   * @returns {number|undefined}
   */
  #extractRecordTimestamp(record) {
    const candidates = [
      record.timestamp,
      record.createdAt,
      record.created_at,
      record.message?.timestamp,
      record.message?.createdAt,
      record.message?.created_at,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
      if (typeof candidate === 'string' && candidate) {
        const parsed = Date.parse(candidate);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract text segments from a JSONL record to scan.
   * @param {Object} record
   * @returns {{ text: string, source: string }[]}
   */
  #extractTextSegments(record) {
    const segments = [];

    if (record.message) {
      // Claude / OpenClaw format: record.message.content
      const content = record.message.content;
      const role = record.message.role || record.role || record.type;

      if (typeof content === 'string') {
        const source = role === 'user' ? 'user_message' : 'assistant_message';
        segments.push({ text: content, source });
        return segments;
      }

      // Handle array content (Claude / OpenClaw format)
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            const source = role === 'user'
              ? 'user_message'
              : role === 'toolResult'
                ? 'tool_output'
                : 'assistant_message';
            segments.push({ text: block.text, source });
          } else if (block.type === 'toolCall') {
            const inputStr = typeof block.arguments === 'string'
              ? block.arguments
              : JSON.stringify(block.arguments ?? block.input ?? block.args ?? {});
            segments.push({ text: inputStr, source: 'tool_input' });
          } else if (block.type === 'tool_use' && block.input) {
            const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
            segments.push({ text: inputStr, source: 'tool_input' });
          } else if (block.type === 'tool_result' || block.type === 'toolResult') {
            const resultStr = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map(c => c.text || '').join(' ')
                : JSON.stringify(block.content || '');
            segments.push({ text: resultStr, source: 'tool_output' });
          }
        }

        // OpenClaw raw transcript: tool result is often a standalone message
        if (role === 'toolResult') {
          const toolName = record.message.toolName || '';
          if (toolName) {
            segments.push({ text: toolName, source: 'tool_name' });
          }
        }
      }
    } else if (Array.isArray(record.content)) {
      // Codex / Gemini format: record.content array of blocks
      for (const block of record.content) {
        if (block.type === 'text' && block.text) {
          segments.push({ text: block.text, source: 'assistant_message' });
        } else if (block.type === 'tool_use' && block.input) {
          const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
          segments.push({ text: inputStr, source: 'tool_input' });
        } else if (block.type === 'tool_result') {
          const resultStr = typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map(c => c.text || '').join(' ')
              : JSON.stringify(block.content || '');
          segments.push({ text: resultStr, source: 'tool_output' });
        }
      }
    }

    return segments;
  }

  /**
   * Find all matches for a rule in text.
   * @param {string} text
   * @param {import('../types.js').SensitiveRule} rule
   * @returns {string[]}
   */
  #findMatches(text, rule) {
    const matches = [];
    for (const pattern of rule.patterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        const value = m[1] || m[0]; // Use capture group if available
        // Run optional validation
        if (rule.validate && !rule.validate(value)) continue;
        matches.push(m[0]); // Always use full match for masking
      }
    }
    return matches;
  }

  /**
   * Build masked context string around a match.
   * @param {string} text
   * @param {string} match
   * @param {import('../types.js').SensitiveRule} rule
   * @returns {string}
   */
  #buildMaskedContext(text, match, rule) {
    const idx = text.indexOf(match);
    if (idx === -1) return rule.mask(match);
    const start = Math.max(0, idx - 20);
    const end = Math.min(text.length, idx + match.length + 20);
    let context = text.slice(start, end);
    // Mask the sensitive part in context
    context = context.replace(match, rule.mask(match));
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    return context;
  }

  /**
   * Get all registered rules.
   * @returns {import('../types.js').SensitiveRule[]}
   */
  getRules() {
    return [...this.#rules];
  }
}
