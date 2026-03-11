import { getToolEvents } from '../utils.js';

const rule = {
  id: 'R2_tool_loop',
  name: 'Tool Loop',
  severity: 'HIGH',

  check(events, session) {
    const toolEvents = getToolEvents(events);
    if (toolEvents.length === 0) return null;

    // Group by tool name
    const byTool = {};
    for (const e of toolEvents) {
      (byTool[e._toolName] = byTool[e._toolName] || []).push(e);
    }

    const THIRTY_MIN = 30 * 60 * 1000;
    const loops = [];

    for (const [toolName, calls] of Object.entries(byTool)) {
      if (calls.length <= 5) continue;

      // Find clusters within 30 min windows
      const sorted = calls.sort((a, b) => a.timestamp - b.timestamp);

      for (let i = 0; i <= sorted.length - 6; i++) {
        const windowEnd = (sorted[i].timestamp instanceof Date ? sorted[i].timestamp.getTime() : sorted[i].timestamp) + THIRTY_MIN;
        const windowCalls = sorted.filter(c => {
          const t = c.timestamp instanceof Date ? c.timestamp.getTime() : c.timestamp;
          const start = sorted[i].timestamp instanceof Date ? sorted[i].timestamp.getTime() : sorted[i].timestamp;
          return t >= start && t <= windowEnd;
        });

        if (windowCalls.length > 5) {
          // Check interval between calls < 5 min
          let shortIntervals = 0;
          for (let j = 1; j < windowCalls.length; j++) {
            const t1 = windowCalls[j - 1].timestamp instanceof Date ? windowCalls[j - 1].timestamp.getTime() : windowCalls[j - 1].timestamp;
            const t2 = windowCalls[j].timestamp instanceof Date ? windowCalls[j].timestamp.getTime() : windowCalls[j].timestamp;
            if (t2 - t1 < 5 * 60 * 1000) shortIntervals++;
          }

          if (shortIntervals >= windowCalls.length - 2) {
            loops.push({ toolName, calls: windowCalls });
            break; // one loop per tool is enough
          }
        }
      }
    }

    if (loops.length === 0) return null;

    let totalWasted = 0;
    const allEvidence = [];

    for (const loop of loops) {
      const wasted = loop.calls.reduce((s, c) => s + (c.outputTokens || 0), 0);
      totalWasted += wasted;

      for (const c of loop.calls.slice(0, 10)) {
        allEvidence.push({
          eventId: c.id || c.eventId || `tool-${c._toolName}`,
          sessionId: session.sessionId,
          turnIndex: c._originalIndex ?? events.indexOf(c),
          timestamp: c.timestamp,
          inputTokens: c.inputTokens || 0,
          outputTokens: c.outputTokens || 0,
          wastedTokens: c.outputTokens || 0,
          reason: `Tool "${c._toolName}" called repeatedly (${loop.calls.length} times in 30 min)`,
          toolCalls: [{ name: c._toolName, input: c._toolInput }],
        });
      }
    }

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: loops.length,
      detail: {
        loops: loops.map(l => ({ toolName: l.toolName, count: l.calls.length })),
      },
      estimatedWastedTokens: totalWasted,
      evidence: allEvidence.slice(0, 10),
    };
  },
};

export default rule;
