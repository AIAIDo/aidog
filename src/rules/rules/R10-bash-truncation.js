import { getToolEvents } from '../utils.js';

const rule = {
  id: 'R10_bash_truncation',
  name: 'Bash Truncation',
  severity: 'HIGH',

  check(events, session) {
    const BASH_TOOLS = {
      'claude-code': ['Bash'],
      'opencode': ['mcp__Bash__execute', 'mcp__bash__execute', 'Bash'],
      'openclaw': ['exec', 'bash', 'Bash', 'run_command'],
      'codex': ['run_bash', 'execute_command', 'bash'],
      'gemini': ['run_command', 'run_bash', 'bash'],
    };
    const agent = session?.agent;
    const toolNames = BASH_TOOLS[agent] || ['Bash', 'bash', 'execute_command'];
    const bashEvents = getToolEvents(events, ...toolNames);

    if (bashEvents.length === 0) return null;

    const SIZE_THRESHOLD = 10000; // 10,000 bytes
    const TOKEN_THRESHOLD = 3000;

    const largeBashOutputs = bashEvents.filter(e => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      return outputSize > SIZE_THRESHOLD;
    });

    if (largeBashOutputs.length === 0) return null;

    // Filter to those with estimated tokens > 3000
    const triggered = largeBashOutputs.filter(e => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      const estimatedTokens = Math.round(outputSize / 4);
      return estimatedTokens > TOKEN_THRESHOLD;
    });

    if (triggered.length === 0) return null;

    const wastedTokens = triggered.reduce((s, e) => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      const estimatedTokens = Math.round(outputSize / 4);
      return s + (estimatedTokens - TOKEN_THRESHOLD);
    }, 0);

    const evidence = triggered.slice(0, 10).map((e, idx) => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      const estimatedTokens = Math.round(outputSize / 4);
      return {
        eventId: e.id || e.eventId || `bash-${idx}`,
        sessionId: session.sessionId,
        turnIndex: e._originalIndex ?? events.indexOf(e),
        timestamp: e.timestamp,
        inputTokens: e.inputTokens || 0,
        outputTokens: e.outputTokens || 0,
        wastedTokens: estimatedTokens - TOKEN_THRESHOLD,
        reason: `Bash output ${outputSize} bytes (~${estimatedTokens} tokens) exceeds threshold`,
        toolCalls: [{ name: e._toolName, input: e._toolInput }],
      };
    });

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: triggered.length,
      detail: {
        largeBashOutputCount: triggered.length,
        totalExcessTokens: wastedTokens,
      },
      estimatedWastedTokens: wastedTokens,
      evidence,
    };
  },
};

export default rule;
