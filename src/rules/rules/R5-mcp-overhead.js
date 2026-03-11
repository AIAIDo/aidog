import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const rule = {
  id: 'R5_mcp_overhead',
  name: 'MCP Overhead',
  severity: 'HIGH',
  applicableAgent: 'claude-code',

  check(events, session) {
    // MCP overhead detection only applies to Claude Code (reads ~/.claude/settings.json)
    const agent = session?.agent;
    if (agent && agent !== 'claude-code') return null;

    // Read MCP settings
    let mcpServers = {};
    try {
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      const raw = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      mcpServers = settings.mcpServers || {};
    } catch {
      // No settings file or invalid JSON — skip
      return null;
    }

    const mountedMCPs = Object.keys(mcpServers);
    if (mountedMCPs.length === 0) return null;

    // Collect actually used tools from events
    const usedTools = new Set();
    for (const e of events) {
      if (e.toolName) usedTools.add(e.toolName);
      if (Array.isArray(e.toolCalls)) {
        for (const tc of e.toolCalls) {
          if (tc.name) usedTools.add(tc.name);
        }
      }
    }

    // Determine which MCPs are unused
    // An MCP is considered "used" if any tool starting with "mcp__<serverName>__" was called
    const unusedMCPs = mountedMCPs.filter(name => {
      const prefix = `mcp__${name}__`;
      return ![...usedTools].some(tool => tool.startsWith(prefix));
    });

    const tooManyMCPs = mountedMCPs.length > 5;
    const hasUnused = unusedMCPs.length > 0;

    if (!tooManyMCPs && !hasUnused) return null;

    const turns = events.length;
    const perUnusedLow = 500;
    const perUnusedHigh = 3000;
    const wastedLow = unusedMCPs.length * perUnusedLow * turns;
    const wastedHigh = unusedMCPs.length * perUnusedHigh * turns;
    const estimatedWasted = Math.round((wastedLow + wastedHigh) / 2);

    const evidence = unusedMCPs.slice(0, 10).map((name, idx) => ({
      eventId: `mcp-${name}`,
      sessionId: session.sessionId,
      turnIndex: 0,
      timestamp: events[0]?.timestamp || Date.now(),
      inputTokens: Math.round(perUnusedLow * turns),
      outputTokens: 0,
      wastedTokens: Math.round(((perUnusedLow + perUnusedHigh) / 2) * turns),
      reason: `MCP server "${name}" is mounted but no tools with prefix "mcp__${name}__" were used`,
      toolCalls: [],
    }));

    return {
      ruleId: rule.id,
      severity: rule.severity,
      triggered: true,
      occurrences: unusedMCPs.length + (tooManyMCPs ? 1 : 0),
      detail: {
        mountedMCPs: mountedMCPs.length,
        unusedMCPs,
        tooManyMCPs,
        wastedRange: [wastedLow, wastedHigh],
      },
      estimatedWastedTokens: estimatedWasted,
      evidence,
    };
  },
};

export default rule;
