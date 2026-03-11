import { getToolEvents } from '../utils.js';

const rule = {
  id: 'R9_glob_abuse',
  name: 'Glob Abuse',
  severity: 'MEDIUM',

  check(events, session) {
    const GLOB_TOOLS = {
      'claude-code': ['Glob'],
      'opencode': ['mcp__Glob', 'mcp__FS__find', 'mcp__FS__list'],
      'openclaw': ['glob', 'Glob', 'find', 'list_files', 'list_directory', 'ls'],
      'codex': ['list_files', 'list_directory'],
      'gemini': ['list_directory', 'list_files'],
    };
    const agent = session?.agent;
    const toolNames = GLOB_TOOLS[agent] || ['Glob', 'glob', 'LS', 'ls', 'list_files'];
    const globEvents = getToolEvents(events, ...toolNames);

    if (globEvents.length === 0) return null;

    const CALL_THRESHOLD = 5;
    const SIZE_THRESHOLD = 5000; // 5,000 bytes

    const tooManyCalls = globEvents.length > CALL_THRESHOLD;
    const largeSingleResult = globEvents.some(e => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      return outputSize > SIZE_THRESHOLD;
    });

    if (!tooManyCalls && !largeSingleResult) return null;

    let wastedTokens = 0;

    if (tooManyCalls) {
      // Waste from excessive calls (beyond threshold)
      const excessCalls = globEvents.slice(CALL_THRESHOLD);
      wastedTokens += excessCalls.reduce((s, e) => s + (e.outputTokens || 0), 0);
    }

    if (largeSingleResult) {
      const largeResults = globEvents.filter(e => {
        const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
        return outputSize > SIZE_THRESHOLD;
      });
      wastedTokens += largeResults.reduce((s, e) => {
        const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
        return s + Math.round((outputSize - SIZE_THRESHOLD) / 4);
      }, 0);
    }

    const evidence = globEvents.slice(0, 10).map((e, idx) => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      return {
        eventId: e.id || e.eventId || `glob-${idx}`,
        sessionId: session.sessionId,
        turnIndex: e._originalIndex ?? events.indexOf(e),
        timestamp: e.timestamp,
        inputTokens: e.inputTokens || 0,
        outputTokens: e.outputTokens || 0,
        wastedTokens: e.outputTokens || 0,
        reason: `Glob/LS call #${idx + 1} of ${globEvents.length}${outputSize > SIZE_THRESHOLD ? ` (output ${outputSize} bytes > 5KB)` : ''}`,
        toolCalls: [{ name: e._toolName, input: e._toolInput }],
      };
    });

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: globEvents.length,
      detail: {
        totalGlobCalls: globEvents.length,
        excessiveCalls: tooManyCalls,
        hasLargeResult: largeSingleResult,
      },
      estimatedWastedTokens: wastedTokens,
      evidence,
    };
  },
};

export default rule;
