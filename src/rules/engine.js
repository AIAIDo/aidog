export class RuleEngine {
  constructor() {
    this.rules = [];
    this.disabledRules = new Set();
  }

  registerRule(rule) { this.rules.push(rule); }

  removeRule(ruleId) {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  setDisabledRules(disabledSet) {
    this.disabledRules = disabledSet;
  }

  async analyze(events) {
    const sessions = this.groupBySession(events);
    const results = [];

    for (const [sessionId, sessionEvents] of Object.entries(sessions)) {
      const sortedEvents = sessionEvents.sort((a, b) => a.timestamp - b.timestamp);
      const agent = sortedEvents[0]?.agent || 'unknown';
      for (const rule of this.rules) {
        if (this.disabledRules.has(rule.id)) continue;
        const result = rule.check(sortedEvents, { sessionId, events: sortedEvents, agent });
        if (result?.triggered) results.push({ ...result, sessionId, agent });
      }
    }

    const totalTokens = events.reduce((s, e) => s + (e.inputTokens || 0) + (e.outputTokens || 0), 0);
    const totalSessions = new Set(events.map(e => e.sessionId).filter(Boolean)).size || 1;
    const totalWasted = Math.min(
      results.reduce((s, r) => s + (r.estimatedWastedTokens || 0), 0),
      totalTokens
    );

    return {
      totalTokens,
      totalWastedTokens: totalWasted,
      byRule: this.groupBy(results, 'ruleId'),
      bySeverity: this.groupBy(results, 'severity'),
      healthScore: this.calculateHealthScore(results, totalTokens, totalWasted, totalSessions),
      summary: this.buildSummary(results),
      periodStart: Math.min(...events.map(e => e.timestamp instanceof Date ? e.timestamp.getTime() : e.timestamp)),
      periodEnd: Math.max(...events.map(e => e.timestamp instanceof Date ? e.timestamp.getTime() : e.timestamp)),
    };
  }

  groupBySession(events) {
    return events.reduce((groups, event) => {
      const key = event.sessionId;
      (groups[key] = groups[key] || []).push(event);
      return groups;
    }, {});
  }

  groupBy(items, key) {
    return items.reduce((groups, item) => {
      const val = item[key];
      (groups[val] = groups[val] || []).push(item);
      return groups;
    }, {});
  }

  calculateHealthScore(results, totalTokens, totalWasted, totalSessions = 1) {
    if (totalTokens === 0) return { score: 100, grade: 'A', label: '优秀', breakdown: { wasteRatio: 40, cacheEfficiency: 20, modelFit: 15, sessionHygiene: 15, toolEfficiency: 10 }, trend: 'stable' };

    const safeTotalSessions = Math.max(1, totalSessions);
    const wasteRatio = Math.min(1, Math.max(0, totalWasted / Math.max(totalTokens, 1)));

    // Blend issue coverage with actual waste volume so isolated bad sessions do not tank the score.
    const wasteIssueSessions = new Set(
      results
        .filter(r => ['R1_context_growth', 'R13_session_length', 'R15_io_ratio', 'R3_large_output'].includes(r.ruleId))
        .map(r => r.sessionId)
    ).size;
    const wasteIssueRatio = wasteIssueSessions / safeTotalSessions;
    const normalizedWasteRatio = Math.min(1, wasteRatio / 0.5);
    const wastePenaltyRatio = Math.max(wasteIssueRatio, normalizedWasteRatio);
    const wasteScore = Math.max(0, 40 * (1 - wastePenaltyRatio));

    // cacheEfficiency: fraction of sessions without cache issues
    const cacheBadSessions = new Set(
      results.filter(r => r.ruleId === 'R4_cache_hit').map(r => r.sessionId)
    ).size;
    const cacheScore = Math.max(0, 20 * (1 - cacheBadSessions / safeTotalSessions));

    // modelFit: fraction of sessions without model mismatch
    const modelMismatchSessions = new Set(
      results.filter(r => r.ruleId === 'R12_model_mismatch').map(r => r.sessionId)
    ).size;
    const modelScore = Math.max(0, 15 * (1 - modelMismatchSessions / safeTotalSessions));

    // sessionHygiene: fraction of sessions without session issues
    const sessionIssueSessions = new Set(
      results
        .filter(r => ['R1_context_growth', 'R6_retry_loop', 'R13_session_length'].includes(r.ruleId))
        .map(r => r.sessionId)
    ).size;
    const sessionScore = Math.max(0, 15 * (1 - sessionIssueSessions / safeTotalSessions));

    // toolEfficiency: fraction of sessions without tool issues
    const toolIssueSessions = new Set(
      results
        .filter(r => ['R2_tool_loop', 'R7_file_reread', 'R8_large_file_read', 'R9_glob_abuse', 'R10_bash_truncation'].includes(r.ruleId))
        .map(r => r.sessionId)
    ).size;
    const toolScore = Math.max(0, 10 * (1 - toolIssueSessions / safeTotalSessions));

    const score = Math.round(wasteScore + cacheScore + modelScore + sessionScore + toolScore);

    return {
      score,
      grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F',
      label: score >= 90 ? '优秀' : score >= 75 ? '良好' : score >= 60 ? '一般' : score >= 40 ? '较差' : '需改进',
      breakdown: {
        wasteRatio: Math.round(wasteScore),
        cacheEfficiency: Math.round(cacheScore),
        modelFit: Math.round(modelScore),
        sessionHygiene: Math.round(sessionScore),
        toolEfficiency: Math.round(toolScore),
      },
      trend: 'stable', // Compare with previous would need stored data
    };
  }

  getCacheHitRate(results) {
    // Extract from R4 results or default to 0.5
    const r4 = results.find(r => r.ruleId === 'R4_cache_hit');
    return r4?.detail?.cacheHitRate ?? 1.0;
  }

  countByRule(results, ruleId) {
    return results.filter(r => r.ruleId === ruleId).length;
  }

  countByRules(results, ruleIds) {
    return results.filter(r => ruleIds.includes(r.ruleId)).length;
  }

  buildSummary(results) {
    return results.map(r => ({
      rule: r.ruleId,
      severity: r.severity,
      occurrences: r.occurrences,
      estimatedWastedTokens: r.estimatedWastedTokens,
      detail: r.detail,
    }));
  }
}
