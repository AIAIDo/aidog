import { getToolEvents } from '../utils.js';

const rule = {
  id: 'R11_test_suite',
  name: 'Test Suite',
  severity: 'MEDIUM',

  check(events, session) {
    const TEST_KEYWORDS = /\b(test|jest|pytest|vitest|mocha|karma|cypress|playwright|npm\s+test|yarn\s+test|pnpm\s+test|npx\s+vitest|npx\s+jest)\b/i;
    const TOKEN_THRESHOLD = 5000;

    const bashEvents = getToolEvents(events, 'Bash', 'bash', 'execute_command');

    const testRuns = bashEvents.filter(e => {
      const input = e._toolInput?.command || e._toolInput || '';
      const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
      return TEST_KEYWORDS.test(inputStr);
    });

    if (testRuns.length === 0) return null;

    const largeTestRuns = testRuns.filter(e => (e.outputTokens || 0) > TOKEN_THRESHOLD);
    if (largeTestRuns.length === 0) return null;

    const wastedTokens = largeTestRuns.reduce((s, e) => s + ((e.outputTokens || 0) - TOKEN_THRESHOLD), 0);

    const evidence = largeTestRuns.slice(0, 10).map((e, idx) => {
      const input = e._toolInput?.command || e._toolInput || '';
      const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
      return {
        eventId: e.id || e.eventId || `test-${idx}`,
        sessionId: session.sessionId,
        turnIndex: e._originalIndex ?? events.indexOf(e),
        timestamp: e.timestamp,
        inputTokens: e.inputTokens || 0,
        outputTokens: e.outputTokens || 0,
        wastedTokens: (e.outputTokens || 0) - TOKEN_THRESHOLD,
        reason: `Test command "${inputStr.slice(0, 80)}" produced ${e.outputTokens} output tokens (>${TOKEN_THRESHOLD} threshold)`,
        toolCalls: [{ name: e._toolName, input: e._toolInput }],
      };
    });

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: largeTestRuns.length,
      detail: {
        totalTestRuns: testRuns.length,
        largeOutputRuns: largeTestRuns.length,
        totalExcessTokens: wastedTokens,
      },
      estimatedWastedTokens: wastedTokens,
      evidence,
    };
  },
};

export default rule;
