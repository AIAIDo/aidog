const rule = {
  id: 'R13_session_length',
  name: 'Session Length',
  severity: 'HIGH',

  check(events, session) {
    const turns = events.filter(e => (e.inputTokens || 0) > 0);
    if (turns.length <= 15) return null;

    const first5 = turns.slice(0, 5);
    const last5 = turns.slice(-5);

    const avgFirst5 = first5.reduce((s, e) => s + e.inputTokens, 0) / first5.length;
    const avgLast5 = last5.reduce((s, e) => s + e.inputTokens, 0) / last5.length;

    if (avgLast5 < avgFirst5 * 2) return null;

    // Waste: cumulative excess tokens after turn 15
    const turnsAfter15 = turns.slice(15);
    const baseline = avgFirst5;
    const wastedTokens = turnsAfter15.reduce((s, t) => {
      const excess = t.inputTokens - baseline;
      return s + Math.max(0, excess);
    }, 0);

    const evidence = turnsAfter15.slice(0, 10).map((t, idx) => ({
      eventId: t.id || t.eventId || `long-session-${idx}`,
      sessionId: session.sessionId,
      turnIndex: events.indexOf(t),
      timestamp: t.timestamp,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens || 0,
      wastedTokens: Math.max(0, t.inputTokens - baseline),
      reason: `Turn ${15 + idx + 1} of ${turns.length}: input ${t.inputTokens} tokens (baseline avg: ${Math.round(baseline)})`,
      toolCalls: t.toolCalls || [],
    }));

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: turnsAfter15.length,
      detail: {
        totalTurns: turns.length,
        avgFirst5Input: Math.round(avgFirst5),
        avgLast5Input: Math.round(avgLast5),
        growthRatio: +(avgLast5 / avgFirst5).toFixed(2),
      },
      estimatedWastedTokens: Math.round(wastedTokens),
      evidence,
    };
  },
};

export default rule;
