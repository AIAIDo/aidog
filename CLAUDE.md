# aidog - ChatOps Toolkit Dashboard

> 面向所有聊天代理的成本、性能、安全、治理统一守护仪表盘

## Quick Commands

### Build & Restart Server
```bash
# Build frontend (required after modifying src/web/src/**)
npm run build:web

# Kill existing and start fresh (use nohup to prevent process cleanup)
lsof -i :3000 -t | xargs kill -9 2>/dev/null; sleep 1
nohup node bin/aidog.js serve --port 3000 > /tmp/aidog-server.log 2>&1 &
# Check logs: tail -f /tmp/aidog-server.log
```

**Important:** Frontend is served from `src/web/dist/` (pre-built static files). Any changes to `src/web/src/**` require `npm run build:web` to take effect.

### Dev Mode
```bash
npm run dev
```

## Project Structure

- `bin/aidog.js` - CLI entrypoint
- `src/cli/commands/serve.js` - `aidog serve` command (starts web dashboard)
- `src/server/` - Express API server
  - `routes/sessions.js` - Sessions list & detail APIs
- `src/storage/sqlite.js` - SQLite storage layer (better-sqlite3)
- `src/storage/schema.sql` - DB schema
- `src/plugins/claude-code/` - Claude Code JSONL parser
- `src/web/src/` - React frontend (Vite)
  - `pages/Sessions.jsx` - Sessions page
  - `components/MessageList.jsx` - Message list with sorting

## Database

- Default path: `~/.aidog/data.db`
- Uses better-sqlite3 with WAL mode
- Main table: `token_events` (all parsed JSONL events)

## Key Notes

- Claude Code JSONL records are API responses (`role: "assistant"`). User messages have zero tokens — this is normal, not a bug.
- Sessions API uses DB-level `GROUP BY session_id` aggregation for performance.
