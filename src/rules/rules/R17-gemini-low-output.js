const rule = {
  id: 'R17_gemini_low_output',
  name: 'Gemini Low Output Efficiency',
  severity: 'MEDIUM',
  applicableAgent: 'gemini',
  description: 'Gemini session consumes large input tokens but produces minimal output, suggesting context pollution',

  check(events, session) {
    if (session?.agent !== 'gemini') return null;

    const assistantEvents = events.filter(e => e.role === 'assistant');
    if (assistantEvents.length < 5) return null;

    const totalInput = assistantEvents.reduce((s, e) => s + (e.inputTokens || 0), 0);
    const totalOutput = assistantEvents.reduce((s, e) => s + (e.outputTokens || 0), 0);

    if (totalInput < 10000) return null; // Only flag when substantial tokens are used
    const ratio = totalOutput / totalInput;
    if (ratio >= 0.03) return null; // Only flag < 3% output ratio

    // Wasted tokens = input that generated minimal output (80% of excess input)
    const expectedMinOutput = totalInput * 0.03;
    const wastedTokens = Math.round((totalInput - expectedMinOutput) * 0.5);

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: assistantEvents.length,
      detail: {
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        outputRatio: (ratio * 100).toFixed(1) + '%',
        sessionTurns: assistantEvents.length,
      },
      estimatedWastedTokens: Math.max(0, wastedTokens),
      evidence: assistantEvents.slice(-5).map((e, idx) => ({
        eventId: e.id || `gemini-lo-${idx}`,
        sessionId: session.sessionId,
        turnIndex: events.indexOf(e),
        timestamp: e.timestamp,
        inputTokens: e.inputTokens || 0,
        outputTokens: e.outputTokens || 0,
        wastedTokens: Math.round((e.inputTokens || 0) * 0.5),
        reason: `Turn ${idx + 1}: ${e.inputTokens} input → only ${e.outputTokens} output tokens (${((e.outputTokens || 0) / Math.max(e.inputTokens || 1, 1) * 100).toFixed(1)}% ratio)`,
        toolCalls: e.toolCalls || [],
      })),
    };
  },
};

export default rule;
