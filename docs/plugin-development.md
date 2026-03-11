# Plugin Development Guide

This guide explains how to extend AIDog beyond the built-in collectors.

## Current Coverage

AIDog currently ships with built-in collectors for:

- Claude Code
- Codex CLI
- Gemini CLI
- OpenCode
- OpenClaw

SDK-based agents, internal agent platforms, queue-driven runners, and unsupported CLIs are not auto-collected by default. Those scenarios should be integrated through a custom plugin.

## When You Need a Plugin

Build a plugin when your agent:

- Calls OpenAI, Anthropic, Gemini, or other model SDKs directly
- Stores conversation history in your own database or log files
- Runs inside a server, job worker, or multi-agent orchestrator
- Uses a CLI or runtime that AIDog does not parse natively yet

## Plugin Contract

The plugin interface lives in [src/plugins/interface.js](../src/plugins/interface.js).

Each plugin must provide:

- `meta`: plugin metadata
- `isAvailable()`: whether the data source is reachable
- `fetchHistory(since)`: historical token events
- `watch(callback)`: realtime streaming updates
- `getCurrentSession()`: latest active session summary

Optional:

- `getDataPaths(since)`: raw file paths used by security scanning

## Normalized Event Shape

Every plugin should emit AIDog `TokenEvent` records. The important fields are:

```js
{
  id: "req_123",
  agent: "my-sdk-agent",
  sessionId: "session_abc",
  project: "payments-service",
  timestamp: new Date(),
  role: "assistant",
  model: "gpt-4o",
  usage: {
    input_tokens: 1200,
    output_tokens: 340,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  toolCalls: [
    { type: "tool_use", name: "search", inputSize: 128, outputSize: 2048, isError: false },
  ],
  content: [{ type: "text", text: "Result summary" }],
}
```

Once your data is normalized into this shape, the rest of AIDog works the same way: stats, diagnostics, performance analysis, security scanning, and the dashboard.

## SDK Skeleton

A reusable SDK-oriented skeleton is included at [src/plugins/sdk/index.js](../src/plugins/sdk/index.js).

It provides:

- `createSDKTokenEvent(rawEvent)` to normalize SDK/runtime events
- `SDKPlugin` to wrap your own history reader and realtime subscriber
- a placeholder default export that you can copy into a user plugin

## Recommended Setup

1. Copy [src/plugins/sdk/index.js](../src/plugins/sdk/index.js) to `~/.aidog/plugins/<your-plugin>/index.js`.
2. Replace `isAvailable`, `readHistory`, `subscribe`, and `getSession` with your own adapters.
3. Return raw events from your own source and let `createSDKTokenEvent()` normalize them.
4. Run `aidog setup` and `aidog serve`.

## Example Integration Points

Common places to connect SDK-based agents:

- application database tables containing requests and responses
- append-only JSONL logs
- Kafka, Redis Streams, SQS, or internal event buses
- in-process event emitters around your SDK wrapper
- webhooks written to disk for later ingestion

## Realtime vs Historical Data

For the best user experience, implement both:

- `fetchHistory()` for backfill and trend analysis
- `watch()` for live dashboard updates

If you only implement `fetchHistory()`, AIDog can still analyze imported history, but the live dashboard will not update in realtime.

## Session Design Advice

Use stable `sessionId` values. AIDog's diagnostics and performance metrics are session-centric, so poor session boundaries will make the analysis noisy.

Good session boundaries usually map to:

- one user task
- one agent run
- one workflow execution
- one conversation thread

## Security Scan Support

If your agent writes prompt/response artifacts to files, implement `getDataPaths()` so AIDog can include them in leakage and exposure scans.

If your SDK data only lives in a database, you can skip this method and still use cost/performance/diagnostics features.

## Reference Implementations

You can use these built-in plugins as examples:

- [src/plugins/codex/index.js](../src/plugins/codex/index.js)
- [src/plugins/claude-code/index.js](../src/plugins/claude-code/index.js)
- [src/plugins/gemini/index.js](../src/plugins/gemini/index.js)
- [src/plugins/opencode/index.js](../src/plugins/opencode/index.js)
- [src/plugins/openclaw/index.js](../src/plugins/openclaw/index.js)
