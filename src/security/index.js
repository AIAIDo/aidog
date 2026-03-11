import { v4 as uuidv4 } from 'uuid';
import { LeakageScanner } from './leakage/index.js';
import { ExposureChecker } from './exposure/index.js';

/**
 * SecurityEngine — unified entry point for all security scanning.
 */
export class SecurityEngine {
  /**
   * Normalize a timestamp value to epoch milliseconds.
   * @param {number|string|undefined|null} value
   * @returns {number|null}
   */
  static normalizeTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  /**
   * @param {Object} options
   * @param {import('../storage/sqlite.js').SQLiteStorage} [options.storage]
   * @param {import('../plugins/registry.js').PluginRegistry} [options.pluginRegistry]
   * @param {Array} [options.customRules]
   */
  constructor({ storage, pluginRegistry, customRules } = {}) {
    this.storage = storage || null;
    this.pluginRegistry = pluginRegistry || null;
    this.leakageScanner = new LeakageScanner({ customRules });
    this.exposureChecker = new ExposureChecker();
  }

  /**
   * Run full security scan (exposure + leakage).
   * @param {Object} [options]
   * @param {Date} [options.since]
   * @param {string[]} [options.ruleIds]
   * @param {number[]} [options.ports]
   * @param {string} [options.triggerSource]
   * @returns {Promise<import('./types.js').SecurityScanResult>}
   */
  async scan(options = {}) {
    const scanId = `sec_${uuidv4().slice(0, 12)}`;
    const [leakage, exposure] = await Promise.all([
      this.scanLeakage({ ...options, scanId }),
      this.scanExposure({ ...options, scanId }),
    ]);
    const securityScore = this.calculateSecurityScore(leakage, exposure);
    return { scanId, scannedAt: new Date(), leakage, exposure, securityScore };
  }

  /**
   * Run leakage scan only.
   * @param {Object} [options]
   * @returns {Promise<import('./types.js').LeakageScanResult>}
   */
  async scanLeakage(options = {}) {
    const allPaths = [];
    if (this.pluginRegistry) {
      const plugins = await this.pluginRegistry.getAvailable();
      for (const plugin of plugins) {
        if (typeof plugin.getDataPaths === 'function') {
          const paths = await plugin.getDataPaths(options.since);
          allPaths.push(...paths);
        }
      }
    }
    return this.leakageScanner.scan(allPaths, options);
  }

  /**
   * Run exposure scan only.
   * @param {Object} [options]
   * @returns {Promise<import('./types.js').ExposureScanResult>}
   */
  async scanExposure(options = {}) {
    return this.exposureChecker.check(options);
  }

  /**
   * List all security detection rules.
   * @returns {{ builtIn: import('./types.js').SensitiveRule[], custom: import('./types.js').SensitiveRule[] }}
   */
  listRules() {
    const rules = this.leakageScanner.getRules();
    return {
      builtIn: rules.filter(r => r.builtIn !== false),
      custom: rules.filter(r => r.builtIn === false),
    };
  }

  /**
   * Apply exponential time decay to a penalty.
   * Half-life of 14 days: a finding 14 days old has 50% weight.
   * @param {number} basePenalty
   * @param {number} daysSinceFound
   * @param {number} [halfLife=14]
   * @returns {number}
   */
  static applyTimeDecay(basePenalty, daysSinceFound, halfLife = 14) {
    if (daysSinceFound <= 0) return basePenalty;
    const lambda = Math.LN2 / halfLife;
    return basePenalty * Math.exp(-lambda * daysSinceFound);
  }

  /**
   * Saturation curve to prevent many low-severity findings from tanking the score.
   * Asymptotically approaches maxDeduction.
   * @param {number} rawDeduction
   * @param {number} [maxDeduction=50]
   * @returns {number}
   */
  static applySaturation(rawDeduction, maxDeduction = 50) {
    if (rawDeduction <= 0) return 0;
    return maxDeduction * (1 - Math.exp(-rawDeduction / maxDeduction));
  }

  /**
   * Compute trend from score history using linear regression.
   * @param {Array<{date: string, score: number}>} scoreHistory - sorted oldest first
   * @returns {import('../types.js').ScoreTrend}
   */
  static computeTrend(scoreHistory) {
    if (!scoreHistory || scoreHistory.length === 0) {
      return { direction: 'stable', delta: 0, history: [] };
    }

    const history = scoreHistory.map(h => ({ date: h.date, score: h.score }));

    if (history.length < 2) {
      return { direction: 'stable', delta: 0, history };
    }

    // Delta: latest score minus score from ~7 days ago (or earliest)
    const latest = history[history.length - 1];
    const sevenDaysAgo = new Date(latest.date);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysStr = sevenDaysAgo.toISOString().slice(0, 10);
    // Find the closest point to 7 days ago
    let closest = history[0];
    for (const h of history) {
      if (h.date <= sevenDaysStr) closest = h;
    }
    const delta = Math.round(latest.score - closest.score);

    // Linear regression for direction
    const n = history.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += history[i].score;
      sumXY += i * history[i].score;
      sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    let direction = 'stable';
    if (slope > 1.0) direction = 'improving';
    else if (slope < -1.0) direction = 'declining';

    return { direction, delta, history };
  }

  /**
   * Calculate security health score with time decay and saturation.
   * @param {import('./types.js').LeakageScanResult|null} leakageResult
   * @param {import('./types.js').ExposureScanResult|null} exposureResult
   * @param {Object} [options]
   * @param {number} [options.now] - Current timestamp (ms) for decay calculation
   * @param {Array<{date: string, score: number}>} [options.scoreHistory] - Previous scores for trend
   * @returns {import('../types.js').SecurityHealthScore}
   */
  calculateSecurityScore(leakageResult, exposureResult, options = {}) {
    const now = options.now || Date.now();
    const leakageDeductions = { critical: 20, high: 10, medium: 4, low: 1 };
    const exposureDeductions = { critical: 25, high: 15, medium: 6, low: 2 };

    // Leakage score (0-50)
    let rawLeakageDeduction = 0;
    if (leakageResult) {
      for (const finding of leakageResult.findings) {
        const base = leakageDeductions[finding.severity] || 0;
        const createdAt = SecurityEngine.normalizeTimestamp(finding.createdAt ?? finding.created_at) ?? now;
        const daysOld = Math.max(0, (now - createdAt) / (24 * 60 * 60 * 1000));
        rawLeakageDeduction += SecurityEngine.applyTimeDecay(base, daysOld);
      }
    }
    const leakageScore = Math.round(50 - SecurityEngine.applySaturation(rawLeakageDeduction, 50));

    // Exposure score (0-50)
    let rawExposureDeduction = 0;
    if (exposureResult) {
      for (const f of exposureResult.portFindings) {
        if (f.reachable) {
          rawExposureDeduction += exposureDeductions[f.severity] || 0;
        }
      }
      // Local 0.0.0.0 bindings (lower weight than reachable ports)
      for (const f of (exposureResult.localBindingFindings || [])) {
        rawExposureDeduction += Math.ceil((exposureDeductions[f.severity] || 0) * 0.5);
      }
      // Tunnels as high-severity exposure
      rawExposureDeduction += (exposureResult.tunnelFindings?.length || 0) * 12;
    }
    const exposureScore = Math.round(50 - SecurityEngine.applySaturation(rawExposureDeduction, 50));

    const score = leakageScore + exposureScore;
    const result = {
      score,
      grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F',
      label: score >= 90 ? 'Safe' : score >= 75 ? 'Caution' : score >= 60 ? 'Warning' : score >= 40 ? 'Danger' : 'Critical Risk',
      breakdown: { leakage: leakageScore, exposure: exposureScore },
    };

    // Compute trend if history provided
    if (options.scoreHistory) {
      result.trend = SecurityEngine.computeTrend(options.scoreHistory);
    }

    return result;
  }
}
