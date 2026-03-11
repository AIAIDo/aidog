# CLI Adapter for AI Analysis

> Date: 2026-03-11
> Status: Approved

## Problem

AI analysis requires users to configure API keys (SK) for each provider. Users who already have agent CLIs installed and authenticated (via subscription plans, OAuth, browser login) cannot leverage their existing auth.

## Solution

Add a unified `CliAdapter` in `src/ai/adapters/cli.js` that calls agent CLI commands directly for AI analysis, bypassing the need for API keys.

## Supported Agents

| Agent | Command | Detection |
|-------|---------|-----------|
| Claude Code | `claude -p "<prompt>"` | `which claude` |
| Gemini CLI | `gemini -p "<prompt>"` | `which gemini` |
| Codex CLI | `codex exec "<prompt>"` | `which codex` |
| OpenCode | `opencode run "<prompt>"` | `which opencode` |

## Architecture

### CliAdapter (`src/ai/adapters/cli.js`)

Single adapter class with a `CLI_AGENTS` config table mapping each agent to its command template.

```js
const CLI_AGENTS = {
  claude:   { cmd: 'claude',   args: (prompt) => ['-p', prompt] },
  gemini:   { cmd: 'gemini',   args: (prompt) => ['-p', prompt] },
  codex:    { cmd: 'codex',    args: (prompt) => ['exec', prompt] },
  opencode: { cmd: 'opencode', args: (prompt) => ['run', prompt] },
};
```

**Key methods:**
- `isAvailable()` — runs `which <cmd>` for each agent, returns true if any is found
- `analyze(systemPrompt, userPrompt)` — spawns CLI subprocess via `child_process.execFile`, combines system+user prompt into a single prompt string, captures stdout
- `_detectAgent()` — picks the first available CLI in priority order: claude > gemini > codex > opencode

**Meta:**
```js
meta = { name: 'cli', displayName: 'Agent CLI', requiresApiKey: false, supportsStreaming: false, isLocal: true }
```

### AIManager Changes (`src/ai/index.js`)

1. Import and register `CliAdapter`
2. Update auto-selection priority: **cli > ollama > claude > openai > gemini > ...**

### Prompt Handling

Combine system prompt + user prompt into one string since CLIs accept a single prompt input:
```
{systemPrompt}\n\n{userPrompt}
```

### Timeout & Error Handling

- Default timeout: 120 seconds (CLI calls can be slow)
- On timeout: throw error with clear message
- On non-zero exit: throw error with stderr content

## Files Changed

1. **New:** `src/ai/adapters/cli.js` — CliAdapter implementation
2. **Modified:** `src/ai/index.js` — register CliAdapter, update priority
