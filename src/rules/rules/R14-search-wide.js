import { getToolEvents } from '../utils.js';

const rule = {
  id: 'R14_search_wide',
  name: 'Search Wide',
  severity: 'LOW',

  check(events, session) {
    const grepEvents = getToolEvents(events, 'Grep', 'grep', 'search', 'ripgrep');

    if (grepEvents.length === 0) return null;

    const TOKEN_THRESHOLD = 2000; // ~8,000 bytes
    const BYTES_THRESHOLD = 8000;

    const wideSearches = grepEvents.filter(e => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      return (e.outputTokens || 0) > TOKEN_THRESHOLD || outputSize > BYTES_THRESHOLD;
    });

    if (wideSearches.length === 0) return null;

    const wastedTokens = wideSearches.reduce((s, e) => {
      const excess = (e.outputTokens || 0) - TOKEN_THRESHOLD;
      return s + Math.max(0, excess);
    }, 0);

    const evidence = wideSearches.slice(0, 10).map((e, idx) => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      return {
        eventId: e.id || e.eventId || `search-${idx}`,
        sessionId: session.sessionId,
        turnIndex: e._originalIndex ?? events.indexOf(e),
        timestamp: e.timestamp,
        inputTokens: e.inputTokens || 0,
        outputTokens: e.outputTokens || 0,
        wastedTokens: Math.max(0, (e.outputTokens || 0) - TOKEN_THRESHOLD),
        reason: `Grep result ${e.outputTokens || 0} tokens (~${outputSize} bytes) exceeds threshold`,
        toolCalls: [{ name: e._toolName, input: e._toolInput }],
      };
    });

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: wideSearches.length,
      detail: {
        wideSearchCount: wideSearches.length,
        totalGrepCalls: grepEvents.length,
      },
      estimatedWastedTokens: wastedTokens,
      evidence,
    };
  },
};

export default rule;
