import { getToolEvents } from '../utils.js';

const rule = {
  id: 'R16_opencode_mcp_saturation',
  name: 'OpenCode MCP Saturation',
  severity: 'MEDIUM',
  applicableAgent: 'opencode',
  description: 'OpenCode session has excessive MCP tool calls, suggesting redundant file access via MCP',

  check(events, session) {
    if (session?.agent !== 'opencode') return null;

    // Get all tool events
    const allToolEvents = getToolEvents(events);
    if (allToolEvents.length < 10) return null;

    // Count MCP-prefixed tool calls
    const mcpEvents = allToolEvents.filter(e => (e._toolName || '').startsWith('mcp__'));
    const mcpRatio = mcpEvents.length / allToolEvents.length;

    // Trigger if > 70% of tool calls are MCP AND more than 20 total tool calls
    if (mcpRatio < 0.7 || allToolEvents.length < 20) return null;

    const wastedTokens = mcpEvents.slice(Math.floor(mcpEvents.length * 0.3))
      .reduce((s, e) => s + (e.outputTokens || 0), 0);

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: mcpEvents.length,
      detail: {
        totalToolCalls: allToolEvents.length,
        mcpToolCalls: mcpEvents.length,
        mcpRatio: Math.round(mcpRatio * 100) + '%',
      },
      estimatedWastedTokens: wastedTokens,
      evidence: mcpEvents.slice(0, 5).map((e, idx) => ({
        eventId: e.id || `mcp-sat-${idx}`,
        sessionId: session.sessionId,
        turnIndex: events.indexOf(e),
        timestamp: e.timestamp,
        inputTokens: e.inputTokens || 0,
        outputTokens: e.outputTokens || 0,
        wastedTokens: e.outputTokens || 0,
        reason: `MCP tool call ${e._toolName} (${mcpEvents.length} of ${allToolEvents.length} calls are MCP)`,
        toolCalls: [{ name: e._toolName, input: e._toolInput }],
      })),
    };
  },
};

export default rule;
