const rule = {
  id: 'R1_context_growth',
  name: 'Context Growth',
  severity: 'HIGH',

  check(events, session) {
    const turns = events.filter(e => e.inputTokens > 0);
    if (turns.length < 6) return null;

    // Check for 5+ consecutive turns with >20% growth
    let consecutiveGrowth = 0;
    let maxConsecutive = 0;
    let growthStartIdx = 0;

    for (let i = 1; i < turns.length; i++) {
      const growth = (turns[i].inputTokens - turns[i - 1].inputTokens) / turns[i - 1].inputTokens;
      if (growth > 0.2) {
        if (consecutiveGrowth === 0) growthStartIdx = i - 1;
        consecutiveGrowth++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveGrowth);
      } else {
        consecutiveGrowth = 0;
      }
    }

    if (maxConsecutive < 5) return null;

    const firstInput = turns[0].inputTokens;
    const lastInput = turns[turns.length - 1].inputTokens;
    if (lastInput < firstInput * 3) return null;

    // Calculate wasted tokens: cumulative input above baseline
    const baseline = firstInput;
    let wastedTokens = 0;
    for (const turn of turns) {
      if (turn.inputTokens > baseline) {
        wastedTokens += turn.inputTokens - baseline;
      }
    }

    const evidence = turns
      .filter(t => t.inputTokens > baseline)
      .slice(-10)
      .map((t, idx) => ({
        eventId: t.id || t.eventId || `turn-${idx}`,
        sessionId: session.sessionId,
        turnIndex: events.indexOf(t),
        timestamp: t.timestamp,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens || 0,
        wastedTokens: t.inputTokens - baseline,
        reason: `Input tokens grew to ${t.inputTokens} (baseline: ${baseline})`,
        toolCalls: t.toolCalls || [],
      }));

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: maxConsecutive,
      detail: {
        firstInputTokens: firstInput,
        lastInputTokens: lastInput,
        growthRatio: +(lastInput / firstInput).toFixed(2),
        consecutiveGrowthTurns: maxConsecutive,
      },
      estimatedWastedTokens: wastedTokens,
      evidence,
    };
  },
};

export default rule;
