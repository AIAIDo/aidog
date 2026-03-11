import { EventEmitter } from 'events';

/**
 * AnalysisScheduler - Periodically runs rule-based analysis on token events.
 */
export class AnalysisScheduler extends EventEmitter {
  /**
   * @param {import('../storage/sqlite.js').SQLiteStorage} storage
   * @param {import('../rules/engine.js').RuleEngine} ruleEngine
   * @param {number} intervalMinutes - How often to run analysis (in minutes)
   */
  constructor(storage, ruleEngine, intervalMinutes = 30) {
    super();
    this.storage = storage;
    this.ruleEngine = ruleEngine;
    this.intervalMinutes = intervalMinutes;
    this._intervalHandle = null;
    this._running = false;
    this._lastRun = null;
    this._lastResult = null;
    this._runCount = 0;
  }

  /**
   * Start periodic analysis.
   */
  start() {
    if (this._intervalHandle) return;
    if (this.intervalMinutes <= 0) return; // 0 or negative disables scheduling

    this._intervalHandle = setInterval(
      () => this.runAnalysis(),
      this.intervalMinutes * 60 * 1000,
    );

    // Run once immediately on start
    this.runAnalysis();
  }

  /**
   * Stop periodic analysis.
   */
  stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
  }

  /**
   * Trigger an immediate analysis run (with concurrency guard).
   * @returns {Promise<Object|null>} The analysis result, or null if already running.
   */
  async triggerNow() {
    if (this._running) {
      return null;
    }
    return this.runAnalysis();
  }

  /**
   * Execute analysis: query recent events, run rule engine, save results, emit SSE.
   * @returns {Promise<Object>}
   */
  async runAnalysis() {
    if (this._running) return this._lastResult;
    this._running = true;

    try {
      const now = Date.now();
      const periodDays = 7;
      const start = now - periodDays * 24 * 60 * 60 * 1000;

      const events = this.storage.queryByDateRange(start, now);

      if (!events || events.length === 0) {
        const emptyResult = {
          totalTokens: 0,
          totalWastedTokens: 0,
          healthScore: { score: 100, grade: 'A', label: 'No data' },
          byRule: {},
          bySeverity: {},
          summary: [],
          periodStart: start,
          periodEnd: now,
        };
        this._lastResult = emptyResult;
        this._lastRun = new Date();
        this._runCount++;
        this.emit('analysis', emptyResult);
        return emptyResult;
      }

      const result = await this.ruleEngine.analyze(events);

      // Save to storage
      try {
        this.storage.saveAnalysisBatch(result);
      } catch (err) {
        console.error('[scheduler] Failed to save analysis batch:', err.message);
      }

      this._lastResult = result;
      this._lastRun = new Date();
      this._runCount++;

      // Emit for SSE listeners
      this.emit('analysis', result);

      return result;
    } catch (err) {
      console.error('[scheduler] Analysis failed:', err.message);
      this.emit('error', err);
      return this._lastResult;
    } finally {
      this._running = false;
    }
  }

  /**
   * Get the current schedule status.
   * @returns {Object}
   */
  getScheduleStatus() {
    return {
      running: this._running,
      active: this._intervalHandle !== null,
      intervalMinutes: this.intervalMinutes,
      lastRun: this._lastRun ? this._lastRun.toISOString() : null,
      runCount: this._runCount,
      hasResult: this._lastResult !== null,
    };
  }
}
