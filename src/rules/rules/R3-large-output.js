const rule = {
  id: 'R3_large_output',
  name: 'Large Output',
  severity: 'MEDIUM',

  check(events, session) {
    const turnsWithOutput = events.filter(e => (e.outputTokens || 0) > 0);
    if (turnsWithOutput.length < 2) return null;

    const avgOutput = turnsWithOutput.reduce((s, e) => s + e.outputTokens, 0) / turnsWithOutput.length;
    const threshold = avgOutput * 5;

    const largeTurns = turnsWithOutput.filter(e => e.outputTokens > threshold);
    if (largeTurns.length === 0) return null;

    const wastedTokens = largeTurns.reduce((s, e) => s + (e.outputTokens - avgOutput), 0);

    const evidence = largeTurns.slice(0, 10).map((e, idx) => ({
      eventId: e.id || e.eventId || `turn-${idx}`,
      sessionId: session.sessionId,
      turnIndex: events.indexOf(e),
      timestamp: e.timestamp,
      inputTokens: e.inputTokens || 0,
      outputTokens: e.outputTokens,
      wastedTokens: Math.round(e.outputTokens - avgOutput),
      reason: `Output tokens ${e.outputTokens} exceeds 5x session average (${Math.round(avgOutput)})`,
      toolCalls: e.toolCalls || [],
    }));

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: largeTurns.length,
      detail: {
        sessionAvgOutput: Math.round(avgOutput),
        threshold: Math.round(threshold),
        maxOutput: Math.max(...largeTurns.map(e => e.outputTokens)),
      },
      estimatedWastedTokens: Math.round(wastedTokens),
      evidence,
    };
  },
};

export default rule;
