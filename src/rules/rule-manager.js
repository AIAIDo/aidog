import { allRules } from './index.js';
import { builtInRules } from '../security/leakage/rules/index.js';

const DEFAULT_DISABLED_SECURITY_RULE_IDS = new Set(['S1', 'S2', 'S3']);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BUILT_IN_SECURITY_DEFAULTS = new Map(
  builtInRules.map(rule => [rule.id, {
    id: rule.id,
    name: rule.name,
    severity: (rule.severity || '').toLowerCase(),
    description: rule.description || '',
    definition: {
      matchType: 'regex',
      patterns: rule.patterns.map(p => p.source),
      mask: rule.maskConfig || (
        rule.id === 'S1'
          ? { prefix: 3, suffix: 4 }
          : rule.id === 'S2'
            ? { prefix: 6, suffix: 4 }
            : { prefix: 4, suffix: 4 }
      ),
      category: rule.category || 'leakage',
    },
  }])
);

/**
 * RuleManager — unified management for token analysis and security rules.
 */
export class RuleManager {
  /**
   * @param {Object} options
   * @param {import('../storage/sqlite.js').SQLiteStorage} options.storage
   * @param {import('./engine.js').RuleEngine} options.ruleEngine
   * @param {import('../security/index.js').SecurityEngine} options.securityEngine
   */
  constructor({ storage, ruleEngine, securityEngine }) {
    this.storage = storage;
    this.ruleEngine = ruleEngine;
    this.securityEngine = securityEngine;
    this._builtInSecurityDefaults = BUILT_IN_SECURITY_DEFAULTS;
  }

  /**
   * List all rules (built-in + custom) with enabled state.
   * @param {string} [type] - 'token' | 'security'
   * @returns {Object}
   */
  listAllRules(type) {
    const configs = this.storage.getRuleConfigs(type);
    const configMap = new Map(configs.map(c => [`${c.ruleType}:${c.ruleId}`, c]));
    const overrides = this.storage.getRuleOverrides(type);
    const overrideMap = new Map(overrides.map(o => [`${o.ruleType}:${o.ruleId}`, o]));
    const customRules = this.storage.getCustomRules(type);
    const statsMap = this.storage.getRuleStats();

    const rules = [];

    // Token analysis built-in rules
    if (!type || type === 'token') {
      for (const rule of allRules) {
        const key = `token:${rule.id}`;
        const config = configMap.get(key);
        const stats = statsMap.get(rule.id) || { occurrences: 0, estimatedWastedTokens: 0 };
        rules.push({
          id: rule.id,
          name: rule.name,
          type: 'token',
          severity: (rule.severity || '').toLowerCase(),
          builtIn: true,
          enabled: config ? config.enabled : true,
          description: rule.description || '',
          editable: false,
          occurrences: stats.occurrences,
          estimatedWaste: stats.estimatedWastedTokens,
          applicableAgent: rule.applicableAgent || null,
        });
      }
    }

    // Security built-in rules
    if (!type || type === 'security') {
      for (const rule of builtInRules) {
        const key = `security:${rule.id}`;
        const config = configMap.get(key);
        const override = overrideMap.get(key);
        const stats = statsMap.get(rule.id) || { occurrences: 0, estimatedWastedTokens: 0 };
        const mergedRule = this._mergeSecurityRule(rule, override);
        rules.push({
          id: rule.id,
          name: mergedRule.name,
          type: 'security',
          severity: (mergedRule.severity || '').toLowerCase(),
          builtIn: true,
          enabled: this._isSecurityRuleEnabled(rule.id, config),
          description: mergedRule.description || '',
          definition: mergedRule.definition,
          editable: true,
          deletable: false,
          hasOverride: !!override,
          occurrences: stats.occurrences,
          estimatedWaste: stats.estimatedWastedTokens,
        });
      }
    }

    // Custom rules from DB
    for (const cr of customRules) {
      const key = `${cr.ruleType}:${cr.id}`;
      const config = configMap.get(key);
      const stats = statsMap.get(cr.id) || { occurrences: 0, estimatedWastedTokens: 0 };
      rules.push({
        id: cr.id,
        name: cr.name,
        type: cr.ruleType,
        severity: cr.severity,
        builtIn: false,
        enabled: config ? config.enabled : cr.enabled,
        description: cr.description,
        definition: cr.definition,
        editable: true,
        deletable: true,
        createdAt: cr.createdAt,
        updatedAt: cr.updatedAt,
        occurrences: stats.occurrences,
        estimatedWaste: stats.estimatedWastedTokens,
      });
    }

    return {
      rules,
      counts: {
        total: rules.length,
        enabled: rules.filter(r => r.enabled).length,
        builtIn: rules.filter(r => r.builtIn).length,
        custom: rules.filter(r => !r.builtIn).length,
      },
    };
  }

  /**
   * Get a single rule by id.
   * @param {string} id
   * @param {string} [type]
   * @returns {Object|null}
   */
  getRule(id, type) {
    const { rules } = this.listAllRules(type);
    return rules.find(r => r.id === id) || null;
  }

  /**
   * Toggle a rule's enabled state.
   * @param {string} ruleId
   * @param {string} ruleType - 'token' | 'security'
   * @param {boolean} enabled
   */
  toggleRule(ruleId, ruleType, enabled) {
    this.storage.setRuleConfig(ruleId, ruleType, enabled);

    // Update engine state
    if (ruleType === 'token') {
      this._syncTokenEngineDisabledRules();
    } else if (ruleType === 'security') {
      this._syncSecurityEngineDisabledRules();
    }
  }

  /**
   * Create a custom rule.
   * @param {Object} data
   * @returns {string} id
   */
  createCustomRule(data) {
    const { ruleType, name, severity, description, definition } = data;

    // Validate
    if (!ruleType || !['token', 'security'].includes(ruleType)) {
      throw new Error('ruleType must be "token" or "security"');
    }
    if (!name || typeof name !== 'string') {
      throw new Error('name is required');
    }
    if (!['critical', 'high', 'medium', 'low'].includes((severity || '').toLowerCase())) {
      throw new Error('severity must be critical, high, medium, or low');
    }
    if (!definition || typeof definition !== 'object') {
      throw new Error('definition is required');
    }

    if (ruleType === 'token') {
      this._validateTokenDefinition(definition);
    } else {
      this._validateSecurityDefinition(definition);
    }

    const id = this.storage.saveCustomRule({
      ruleType,
      name,
      severity: severity.toLowerCase(),
      description: description || '',
      definition,
    });

    // Register with engine
    if (ruleType === 'token') {
      const rule = this._buildTokenRule(id, name, severity.toLowerCase(), definition);
      this.ruleEngine.registerRule(rule);
    } else {
      const rule = this._buildSecurityRule(id, name, severity.toLowerCase(), description, definition);
      this.securityEngine.leakageScanner.addRule(rule);
    }

    return id;
  }

  /**
   * Update a custom rule.
   * @param {string} id
   * @param {Object} updates
   * @returns {boolean}
   */
  updateCustomRule(id, updates) {
    const existing = this.storage.getCustomRule(id);
    if (!existing) return false;

    if (updates.definition) {
      if (existing.ruleType === 'token') {
        this._validateTokenDefinition(updates.definition);
      } else {
        this._validateSecurityDefinition(updates.definition);
      }
    }

    if (updates.severity) {
      updates.severity = updates.severity.toLowerCase();
    }

    const success = this.storage.updateCustomRule(id, updates);
    if (success) {
      // Re-sync engines: remove old, add updated
      const updated = this.storage.getCustomRule(id);
      if (updated.ruleType === 'token') {
        this.ruleEngine.removeRule(id);
        if (updated.enabled) {
          const rule = this._buildTokenRule(id, updated.name, updated.severity, updated.definition);
          this.ruleEngine.registerRule(rule);
        }
      } else {
        this.securityEngine.leakageScanner.removeRule(id);
        if (updated.enabled) {
          const rule = this._buildSecurityRule(id, updated.name, updated.severity, updated.description, updated.definition);
          this.securityEngine.leakageScanner.addRule(rule);
        }
      }
    }
    return success;
  }

  /**
   * Update a built-in rule override.
   * @param {string} id
   * @param {string} ruleType
   * @param {Object} updates
   * @returns {boolean}
   */
  updateBuiltInRule(id, ruleType, updates) {
    if (ruleType !== 'security') return false;
    const existing = builtInRules.find(rule => rule.id === id);
    if (!existing) return false;

    if (updates.definition) {
      this._validateSecurityDefinition(updates.definition);
    }

    if (updates.severity) {
      updates.severity = updates.severity.toLowerCase();
      if (!['critical', 'high', 'medium', 'low'].includes(updates.severity)) {
        throw new Error('severity must be critical, high, medium, or low');
      }
    }

    const merged = this._mergeSecurityRule(existing, {
      name: updates.name,
      severity: updates.severity,
      description: updates.description,
      definition: updates.definition,
    });

    this.storage.setRuleOverride(id, ruleType, {
      name: merged.name,
      severity: merged.severity,
      description: merged.description,
      definition: merged.definition,
    });
    this._applySecurityRuleOverrides();
    return true;
  }

  /**
   * Restore a built-in rule to its default definition.
   * @param {string} id
   * @param {string} ruleType
   * @returns {boolean}
   */
  restoreBuiltInRule(id, ruleType) {
    if (ruleType !== 'security') return false;
    const existing = builtInRules.find(rule => rule.id === id);
    if (!existing) return false;
    const deleted = this.storage.deleteRuleOverride(id, ruleType);
    this._applySecurityRuleOverrides();
    return deleted || !!existing;
  }

  /**
   * Delete a custom rule.
   * @param {string} id
   * @returns {boolean}
   */
  deleteCustomRule(id) {
    const existing = this.storage.getCustomRule(id);
    if (!existing) return false;

    const success = this.storage.deleteCustomRule(id);
    if (success) {
      if (existing.ruleType === 'token') {
        this.ruleEngine.removeRule(id);
      } else {
        this.securityEngine.leakageScanner.removeRule(id);
      }
    }
    return success;
  }

  /**
   * Load custom rules from DB and register with engines on startup.
   */
  loadAndSync() {
    this._applySecurityRuleOverrides();

    const customRules = this.storage.getCustomRules();
    for (const cr of customRules) {
      if (!cr.enabled) continue;
      if (cr.ruleType === 'token') {
        const rule = this._buildTokenRule(cr.id, cr.name, cr.severity, cr.definition);
        this.ruleEngine.registerRule(rule);
      } else {
        const rule = this._buildSecurityRule(cr.id, cr.name, cr.severity, cr.description, cr.definition);
        this.securityEngine.leakageScanner.addRule(rule);
      }
    }

    this._syncTokenEngineDisabledRules();
    this._syncSecurityEngineDisabledRules();
  }

  // --- Private methods ---

  _syncTokenEngineDisabledRules() {
    const configs = this.storage.getRuleConfigs('token');
    const disabled = new Set(configs.filter(c => !c.enabled).map(c => c.ruleId));
    this.ruleEngine.setDisabledRules(disabled);
  }

  _syncSecurityEngineDisabledRules() {
    const configs = this.storage.getRuleConfigs('security');
    const configMap = new Map(configs.map(c => [c.ruleId, c]));
    const disabled = new Set(
      builtInRules
        .filter(rule => !this._isSecurityRuleEnabled(rule.id, configMap.get(rule.id)))
        .map(rule => rule.id)
    );

    for (const config of configs) {
      if (!config.enabled) {
        disabled.add(config.ruleId);
      }
    }

    this.securityEngine.leakageScanner.setDisabledRules(disabled);
  }

  _isSecurityRuleEnabled(ruleId, config) {
    if (config) return config.enabled;
    return !DEFAULT_DISABLED_SECURITY_RULE_IDS.has(ruleId);
  }

  _applySecurityRuleOverrides() {
    const overrides = this.storage.getRuleOverrides('security');
    const payload = {};
    for (const override of overrides) {
      const builtIn = builtInRules.find(rule => rule.id === override.ruleId);
      if (!builtIn) continue;
      const merged = this._mergeSecurityRule(builtIn, override);
      payload[override.ruleId] = {
        name: merged.name,
        severity: merged.severity,
        description: merged.description,
        patterns: this._compileSecurityPatterns(merged.definition),
        mask: merged.definition.mask,
      };
    }
    this.securityEngine.leakageScanner.applyRuleOverrides(payload);
  }

  _mergeSecurityRule(rule, override) {
    const base = this._builtInSecurityDefaults.get(rule.id) || {
      id: rule.id,
      name: rule.name,
      severity: (rule.severity || '').toLowerCase(),
      description: rule.description || '',
      definition: this._serializeSecurityRuleDefinition(rule),
    };
    const baseDefinition = base.definition;
    const nextDefinition = override?.definition
      ? this._normalizeSecurityDefinition({ ...baseDefinition, ...override.definition })
      : baseDefinition;

    return {
      id: rule.id,
      name: override?.name || base.name,
      severity: (override?.severity || base.severity || '').toLowerCase(),
      description: override?.description || base.description || '',
      definition: nextDefinition,
    };
  }

  _serializeSecurityRuleDefinition(rule) {
    const defaultMask = rule.id === 'S1'
      ? { prefix: 3, suffix: 4 }
      : rule.id === 'S2'
        ? { prefix: 6, suffix: 4 }
        : { prefix: 4, suffix: 4 };

    return this._normalizeSecurityDefinition({
      matchType: 'regex',
      patterns: rule.patterns.map(p => p.source),
      mask: rule.maskConfig || defaultMask,
      category: rule.category || 'leakage',
    });
  }

  _normalizeSecurityDefinition(definition = {}) {
    const matchType = definition.matchType === 'literal' ? 'literal' : 'regex';
    const patterns = Array.isArray(definition.patterns)
      ? definition.patterns.map(p => `${p ?? ''}`.trim()).filter(Boolean)
      : [];
    const mask = definition.mask
      ? {
          prefix: Math.max(0, Number(definition.mask.prefix) || 0),
          suffix: Math.max(0, Number(definition.mask.suffix) || 0),
        }
      : {
          prefix: Math.max(0, Number(definition.maskLength) || 4),
          suffix: Math.max(0, Number(definition.maskLength) || 4),
        };

    return {
      matchType,
      patterns,
      mask,
      category: definition.category || 'leakage',
    };
  }

  _compileSecurityPatterns(definition) {
    const normalized = this._normalizeSecurityDefinition(definition);
    if (normalized.matchType === 'literal') {
      return normalized.patterns.map(pattern => escapeRegex(pattern));
    }
    return normalized.patterns;
  }

  _validateTokenDefinition(def) {
    const validFields = ['inputTokens', 'outputTokens', 'cacheRead', 'cacheWrite', 'contentLength'];
    const validAggregations = ['max', 'sum', 'avg', 'count'];
    const validOperators = ['>', '<', '>=', '<='];

    if (!validFields.includes(def.field)) {
      throw new Error(`field must be one of: ${validFields.join(', ')}`);
    }
    if (!validAggregations.includes(def.aggregation)) {
      throw new Error(`aggregation must be one of: ${validAggregations.join(', ')}`);
    }
    if (!validOperators.includes(def.operator)) {
      throw new Error(`operator must be one of: ${validOperators.join(', ')}`);
    }
    if (typeof def.threshold !== 'number' || isNaN(def.threshold)) {
      throw new Error('threshold must be a number');
    }
  }

  _validateSecurityDefinition(def) {
    const normalized = this._normalizeSecurityDefinition(def);
    if (!normalized.patterns.length) {
      throw new Error('patterns must be a non-empty array');
    }

    if (!['regex', 'literal'].includes(normalized.matchType)) {
      throw new Error('matchType must be "regex" or "literal"');
    }

    if (normalized.matchType === 'regex') {
      for (const p of normalized.patterns) {
        try {
          new RegExp(p, 'g');
        } catch (e) {
          throw new Error(`Invalid regex pattern "${p}": ${e.message}`);
        }
      }
    }
  }

  /**
   * Build a token analysis rule from a threshold definition.
   */
  _buildTokenRule(id, name, severity, definition) {
    const { field, aggregation, operator, threshold, scope, minEvents } = definition;

    const compare = (val) => {
      switch (operator) {
        case '>': return val > threshold;
        case '<': return val < threshold;
        case '>=': return val >= threshold;
        case '<=': return val <= threshold;
        default: return false;
      }
    };

    return {
      id,
      name,
      severity: severity.toUpperCase(),
      builtIn: false,
      check(events, session) {
        if (minEvents && events.length < minEvents) return null;

        const values = events.map(e => e[field] || 0);

        let aggregatedValue;
        switch (aggregation) {
          case 'max': aggregatedValue = Math.max(...values); break;
          case 'sum': aggregatedValue = values.reduce((s, v) => s + v, 0); break;
          case 'avg': aggregatedValue = values.reduce((s, v) => s + v, 0) / values.length; break;
          case 'count': aggregatedValue = values.filter(v => v > 0).length; break;
          default: return null;
        }

        if (!compare(aggregatedValue)) return null;

        // For event scope, find individual events that trigger
        const triggeredEvents = scope === 'event'
          ? events.filter(e => compare(e[field] || 0))
          : events;

        const evidence = triggeredEvents.slice(0, 10).map((e, idx) => ({
          eventId: e.id || `turn-${idx}`,
          sessionId: session.sessionId,
          turnIndex: events.indexOf(e),
          timestamp: e.timestamp,
          inputTokens: e.inputTokens || 0,
          outputTokens: e.outputTokens || 0,
          wastedTokens: 0,
          reason: `${field} ${aggregation}=${Math.round(aggregatedValue)} ${operator} ${threshold}`,
          toolCalls: e.toolCalls || [],
        }));

        return {
          ruleId: id,
          severity: severity.toUpperCase(),
          triggered: true,
          occurrences: scope === 'event' ? triggeredEvents.length : 1,
          detail: { field, aggregation, operator, threshold, actualValue: Math.round(aggregatedValue) },
          estimatedWastedTokens: 0,
          evidence,
        };
      },
    };
  }

  /**
   * Build a security rule from a regex definition.
   */
  _buildSecurityRule(id, name, severity, description, definition) {
    const normalized = this._normalizeSecurityDefinition(definition);
    const patterns = this._compileSecurityPatterns(normalized);
    const mask = normalized.mask;
    return {
      id,
      name,
      severity,
      category: normalized.category || 'leakage',
      description: description || '用户自定义规则',
      builtIn: false,
      patterns: patterns.map(p => new RegExp(p, 'g')),
      mask(match) {
        if (match.length <= mask.prefix + mask.suffix) return '****';
        return match.slice(0, mask.prefix) + '****' + match.slice(-mask.suffix);
      },
    };
  }
}
