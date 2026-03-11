const rule = {
  id: 'R18_codex_o1_overhead',
  name: 'Codex O1 Reasoning Overhead',
  severity: 'HIGH',
  applicableAgent: 'codex',
  description: 'Codex session uses o1/o1-preview for small tasks where gpt-4o-mini would be more cost-effective',

  check(events, session) {
    if (session?.agent !== 'codex') return null;

    const O1_MODELS = /\b(o1|o1-preview|o1-mini|o3|o3-mini)\b/i;
    const INPUT_THRESHOLD = 3000;  // tokens
    const OUTPUT_THRESHOLD = 800;  // tokens

    const o1SmallTasks = events.filter(e => {
      const model = e.model || '';
      if (!O1_MODELS.test(model)) return false;
      return (e.inputTokens || 0) < INPUT_THRESHOLD && (e.outputTokens || 0) < OUTPUT_THRESHOLD;
    });

    if (o1SmallTasks.length === 0) return null;

    // o1 models cost ~5-10x more than gpt-4o-mini; estimate 60% waste
    const totalTokens = o1SmallTasks.reduce((s, e) => s + (e.inputTokens || 0) + (e.outputTokens || 0), 0);
    const wastedTokens = Math.round(totalTokens * 0.6);

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: o1SmallTasks.length,
      detail: {
        o1TaskCount: o1SmallTasks.length,
        modelsUsed: [...new Set(o1SmallTasks.map(e => e.model))],
        totalTokensOnO1: totalTokens,
      },
      estimatedWastedTokens: wastedTokens,
      evidence: o1SmallTasks.slice(0, 10).map((e, idx) => ({
        eventId: e.id || `o1-oh-${idx}`,
        sessionId: session.sessionId,
        turnIndex: events.indexOf(e),
        timestamp: e.timestamp,
        inputTokens: e.inputTokens || 0,
        outputTokens: e.outputTokens || 0,
        wastedTokens: Math.round(((e.inputTokens || 0) + (e.outputTokens || 0)) * 0.6),
        reason: `Model "${e.model}" used for small task (input: ${e.inputTokens}, output: ${e.outputTokens}) — gpt-4o-mini would suffice`,
        toolCalls: e.toolCalls || [],
      })),
    };
  },
};

export default rule;
