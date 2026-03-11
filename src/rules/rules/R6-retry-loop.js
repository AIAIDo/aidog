const rule = {
  id: 'R6_retry_loop',
  name: 'Retry Loop',
  severity: 'HIGH',

  check(events, session) {
    const turns = events.filter(e => (e.inputTokens || 0) > 0);
    if (turns.length < 4) return null;

    // Find 3+ consecutive turns with >10% input increase
    let maxStreak = 0;
    let currentStreak = 0;
    let streakStart = 0;
    let bestStreakStart = 0;

    for (let i = 1; i < turns.length; i++) {
      const growth = (turns[i].inputTokens - turns[i - 1].inputTokens) / turns[i - 1].inputTokens;
      if (growth > 0.1) {
        if (currentStreak === 0) streakStart = i - 1;
        currentStreak++;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
          bestStreakStart = streakStart;
        }
      } else {
        currentStreak = 0;
      }
    }

    if (maxStreak < 3) return null;

    const retryTurns = turns.slice(bestStreakStart, bestStreakStart + maxStreak + 1);
    const wastedTokens = retryTurns.reduce((s, t) => s + (t.inputTokens || 0), 0);

    const evidence = retryTurns.slice(0, 10).map((t, idx) => ({
      eventId: t.id || t.eventId || `retry-${idx}`,
      sessionId: session.sessionId,
      turnIndex: events.indexOf(t),
      timestamp: t.timestamp,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens || 0,
      wastedTokens: t.inputTokens,
      reason: `Retry turn ${idx + 1}: input tokens ${t.inputTokens}${idx > 0 ? ` (+${((t.inputTokens / retryTurns[idx - 1].inputTokens - 1) * 100).toFixed(0)}%)` : ''}`,
      toolCalls: t.toolCalls || [],
    }));

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: maxStreak,
      detail: {
        consecutiveIncreases: maxStreak,
        startTurnIndex: bestStreakStart,
        inputGrowth: retryTurns.map(t => t.inputTokens),
      },
      estimatedWastedTokens: wastedTokens,
      evidence,
    };
  },
};

export default rule;
