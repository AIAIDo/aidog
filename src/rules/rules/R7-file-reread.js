import { getToolEvents } from '../utils.js';

const rule = {
  id: 'R7_file_reread',
  name: 'File Reread',
  severity: 'MEDIUM',

  check(events, session) {
    // Find Read tool events
    const READ_TOOLS = {
      'claude-code': ['Read'],
      'opencode': ['mcp__Read', 'mcp__FS__read', 'read_file'],
      'openclaw': ['read', 'Read', 'read_file'],
      'codex': ['read_file'],
      'gemini': ['read_file', 'Read'],
    };
    const agent = session?.agent;
    const toolNames = READ_TOOLS[agent] || ['Read', 'read', 'read_file', 'mcp__Read'];
    const readEvents = getToolEvents(events, ...toolNames);

    if (readEvents.length < 3) return null;

    // Group by file path
    const byFile = {};
    for (const e of readEvents) {
      const filePath = e._toolInput?.file_path || e._toolInput?.path || e.filePath || '';
      if (!filePath) continue;
      (byFile[filePath] = byFile[filePath] || []).push(e);
    }

    // Find files read more than 2 times
    const rereads = Object.entries(byFile).filter(([, calls]) => calls.length > 2);
    if (rereads.length === 0) return null;

    let totalWasted = 0;
    const allEvidence = [];

    for (const [filePath, calls] of rereads) {
      // First read is not wasted, subsequent reads are
      const redundant = calls.slice(1);
      const wasted = redundant.reduce((s, c) => s + (c.outputTokens || 0), 0);
      totalWasted += wasted;

      for (const c of redundant.slice(0, 5)) {
        allEvidence.push({
          eventId: c.id || c.eventId || `reread-${filePath}`,
          sessionId: session.sessionId,
          turnIndex: c._originalIndex ?? events.indexOf(c),
          timestamp: c.timestamp,
          inputTokens: c.inputTokens || 0,
          outputTokens: c.outputTokens || 0,
          wastedTokens: c.outputTokens || 0,
          reason: `File "${filePath}" read ${calls.length} times (redundant read)`,
          toolCalls: [{ name: c._toolName, input: c._toolInput }],
        });
      }
    }

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: rereads.length,
      detail: {
        files: rereads.map(([path, calls]) => ({ path, readCount: calls.length })),
      },
      estimatedWastedTokens: totalWasted,
      evidence: allEvidence.slice(0, 10),
    };
  },
};

export default rule;
