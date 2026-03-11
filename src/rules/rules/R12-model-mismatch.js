const rule = {
  id: 'R12_model_mismatch',
  name: 'Model Mismatch',
  severity: 'MEDIUM',

  check(events, session) {
    const agent = session?.agent;

    // Per-agent expensive model patterns
    const EXPENSIVE_BY_AGENT = {
      'claude-code': /\b(opus|claude-3-opus|claude-3\.5-opus|claude-opus)\b/i,
      'opencode':    /\b(opus|claude-3-opus|claude-3\.5-opus|claude-opus)\b/i,
      'openclaw':    /\b(opus|claude-3-opus|claude-3\.5-opus|claude-opus|gpt-4|gpt-4o|gpt-4-turbo|o1|o1-preview|o1-mini|gemini-ultra|gemini-1\.0-ultra|gemini-exp)\b/i,
      'codex':       /\b(gpt-4|gpt-4o|gpt-4-turbo|o1|o1-preview|o1-mini|gpt-4-32k)\b/i,
      'gemini':      /\b(gemini-ultra|gemini-1\.0-ultra|gemini-exp)\b/i,
    };

    // Fall back to original broad regex for unknown agents
    const LARGE_MODELS = EXPENSIVE_BY_AGENT[agent] || /\b(opus|claude-3-opus|claude-3\.5-opus|gpt-4|gpt-4o|gpt-4-turbo|o1-preview|o1-mini)\b/i;

    const INPUT_THRESHOLD = 2000;
    const OUTPUT_THRESHOLD = 500;

    const mismatchTurns = events.filter(e => {
      const model = e.model || '';
      if (!LARGE_MODELS.test(model)) return false;
      return (e.inputTokens || 0) < INPUT_THRESHOLD && (e.outputTokens || 0) < OUTPUT_THRESHOLD;
    });

    if (mismatchTurns.length === 0) return null;

    const totalTokens = mismatchTurns.reduce((s, e) => s + (e.inputTokens || 0) + (e.outputTokens || 0), 0);
    const wastedTokens = Math.round(totalTokens * 0.3); // 30% could have been saved with cheaper model

    const evidence = mismatchTurns.slice(0, 10).map((e, idx) => ({
      eventId: e.id || e.eventId || `mismatch-${idx}`,
      sessionId: session.sessionId,
      turnIndex: events.indexOf(e),
      timestamp: e.timestamp,
      inputTokens: e.inputTokens || 0,
      outputTokens: e.outputTokens || 0,
      wastedTokens: Math.round(((e.inputTokens || 0) + (e.outputTokens || 0)) * 0.3),
      reason: `Model "${e.model}" used for small task (input: ${e.inputTokens}, output: ${e.outputTokens}) — cheaper model would suffice`,
      toolCalls: e.toolCalls || [],
    }));

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: mismatchTurns.length,
      detail: {
        mismatchCount: mismatchTurns.length,
        modelsUsed: [...new Set(mismatchTurns.map(e => e.model))],
        totalTokensOnExpensiveModel: totalTokens,
      },
      estimatedWastedTokens: wastedTokens,
      evidence,
    };
  },
};

export default rule;
