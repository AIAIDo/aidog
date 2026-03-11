const rule = {
  id: 'R15_io_ratio',
  name: 'IO Ratio',
  severity: 'MEDIUM',

  check(events, session) {
    const turnsWithBoth = events.filter(e => (e.inputTokens || 0) > 0 && (e.outputTokens || 0) > 0);
    if (turnsWithBoth.length === 0) return null;

    const totalInput = turnsWithBoth.reduce((s, e) => s + e.inputTokens, 0);
    const totalOutput = turnsWithBoth.reduce((s, e) => s + e.outputTokens, 0);

    const ratio = totalInput / totalOutput;
    const RATIO_THRESHOLD = 20; // healthy is 3-8
    const HEALTHY_RATIO = 8;

    if (ratio <= RATIO_THRESHOLD) return null;

    // Waste: excess input tokens (input - output * healthy_ratio)
    const wastedTokens = Math.round(totalInput - totalOutput * HEALTHY_RATIO);

    const highRatioTurns = turnsWithBoth.filter(e => {
      const r = e.inputTokens / e.outputTokens;
      return r > RATIO_THRESHOLD;
    });

    const evidence = highRatioTurns.slice(0, 10).map((e, idx) => {
      const turnRatio = +(e.inputTokens / e.outputTokens).toFixed(1);
      return {
        eventId: e.id || e.eventId || `io-${idx}`,
        sessionId: session.sessionId,
        turnIndex: events.indexOf(e),
        timestamp: e.timestamp,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        wastedTokens: Math.round(e.inputTokens - e.outputTokens * HEALTHY_RATIO),
        reason: `IO ratio ${turnRatio}:1 (input: ${e.inputTokens}, output: ${e.outputTokens}) — healthy range is 3-8:1`,
        toolCalls: e.toolCalls || [],
      };
    });

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: highRatioTurns.length,
      detail: {
        overallRatio: +ratio.toFixed(2),
        totalInput,
        totalOutput,
        healthyRange: '3-8',
      },
      estimatedWastedTokens: Math.max(0, wastedTokens),
      evidence,
    };
  },
};

export default rule;
