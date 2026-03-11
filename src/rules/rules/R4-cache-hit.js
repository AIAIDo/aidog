const rule = {
  id: 'R4_cache_hit',
  name: 'Cache Hit',
  severity: 'MEDIUM',

  check(events, session) {
    const turnsWithTokens = events.filter(e => (e.inputTokens || 0) > 0);
    if (turnsWithTokens.length === 0) return null;

    const totalInput = turnsWithTokens.reduce((s, e) => s + (e.inputTokens || 0), 0);
    const totalCacheRead = turnsWithTokens.reduce((s, e) => s + (e.cacheReadTokens || e.cache_read || 0), 0);

    const denominator = totalInput + totalCacheRead;
    if (denominator === 0) return null;

    const cacheHitRate = totalCacheRead / denominator;

    if (cacheHitRate >= 0.3) return null;

    const potentialSavings = Math.round(totalInput * 0.3); // Could have cached 30% of input

    const evidence = turnsWithTokens
      .filter(e => {
        const input = e.inputTokens || 0;
        const cached = e.cacheReadTokens || e.cache_read || 0;
        const denom = input + cached;
        return denom > 0 && cached / denom < 0.3;
      })
      .slice(0, 10)
      .map((e, idx) => {
        const input = e.inputTokens || 0;
        const cached = e.cacheReadTokens || e.cache_read || 0;
        const denom = input + cached;
        return {
          eventId: e.id || e.eventId || `turn-${idx}`,
          sessionId: session.sessionId,
          turnIndex: events.indexOf(e),
          timestamp: e.timestamp,
          inputTokens: input,
          outputTokens: e.outputTokens || 0,
          wastedTokens: Math.round(input * 0.3),
          reason: `Cache hit rate ${denom > 0 ? ((cached / denom) * 100).toFixed(1) : 0}% (below 30% threshold)`,
          toolCalls: e.toolCalls || [],
        };
      });

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: 1,
      detail: {
        cacheHitRate: +cacheHitRate.toFixed(4),
        totalInputTokens: totalInput,
        totalCacheReadTokens: totalCacheRead,
      },
      estimatedWastedTokens: potentialSavings,
      evidence,
    };
  },
};

export default rule;
