/**
 * Flattens events into per-tool-call synthetic events.
 * Supports both storage format (toolCalls array) and legacy format (toolName string).
 * @param {Array} events - raw storage events
 * @param {...string} toolNames - tool names to filter (empty = all tools)
 */
export function getToolEvents(events, ...toolNames) {
  const nameSet = toolNames.length > 0 ? new Set(toolNames) : null;
  return events.flatMap((e, i) => {
    // New format: toolCalls array (from storage)
    if (e.toolCalls && e.toolCalls.length > 0) {
      return e.toolCalls
        .filter(tc => !nameSet || nameSet.has(tc.name))
        .map(tc => ({ ...e, _toolName: tc.name, _toolInput: tc.input, _originalIndex: i }));
    }
    // Legacy format: direct toolName (used in tests)
    if (e.toolName && (!nameSet || nameSet.has(e.toolName))) {
      return [{ ...e, _toolName: e.toolName, _toolInput: e.toolInput, _originalIndex: i }];
    }
    return [];
  });
}
