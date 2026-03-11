import { getToolEvents } from '../utils.js';

const rule = {
  id: 'R8_large_file_read',
  name: 'Large File Read',
  severity: 'MEDIUM',

  check(events, session) {
    const readEvents = getToolEvents(events, 'Read', 'read', 'read_file', 'mcp__Read');

    if (readEvents.length === 0) return null;

    const LARGE_THRESHOLD = 50000; // 50,000 bytes
    const RATIO_THRESHOLD = 20;

    const largeReads = readEvents.filter(e => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4; // rough estimate
      return outputSize > LARGE_THRESHOLD;
    });

    if (largeReads.length === 0) return null;

    // Check read/edit ratio
    const editEvents = getToolEvents(events, 'Edit', 'edit', 'write', 'Write');

    const totalReadSize = largeReads.reduce((s, e) => s + (e.outputSize || e.output_size || (e.outputTokens || 0) * 4), 0);
    const totalEditSize = editEvents.reduce((s, e) => s + (e.outputSize || e.output_size || (e.outputTokens || 0) * 4), 0);

    const ratio = totalEditSize > 0 ? totalReadSize / totalEditSize : Infinity;

    const triggered = largeReads.length > 0 && (ratio > RATIO_THRESHOLD || totalEditSize === 0);
    if (!triggered) return null;

    const wastedTokens = largeReads.reduce((s, e) => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      const excess = outputSize - LARGE_THRESHOLD;
      return s + Math.round(excess / 4); // Convert bytes to approx tokens
    }, 0);

    const evidence = largeReads.slice(0, 10).map((e, idx) => {
      const outputSize = e.outputSize || e.output_size || (e.outputTokens || 0) * 4;
      return {
        eventId: e.id || e.eventId || `large-read-${idx}`,
        sessionId: session.sessionId,
        turnIndex: e._originalIndex ?? events.indexOf(e),
        timestamp: e.timestamp,
        inputTokens: e.inputTokens || 0,
        outputTokens: e.outputTokens || 0,
        wastedTokens: Math.round((outputSize - LARGE_THRESHOLD) / 4),
        reason: `Read output ${outputSize} bytes exceeds 50KB threshold (read/edit ratio: ${ratio === Infinity ? 'Infinity' : ratio.toFixed(1)})`,
        toolCalls: [{ name: e._toolName, input: e._toolInput }],
      };
    });

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: largeReads.length,
      detail: {
        largeReadCount: largeReads.length,
        totalReadBytes: totalReadSize,
        totalEditBytes: totalEditSize,
        readEditRatio: ratio === Infinity ? 'Infinity' : +ratio.toFixed(1),
      },
      estimatedWastedTokens: wastedTokens,
      evidence,
    };
  },
};

export default rule;
