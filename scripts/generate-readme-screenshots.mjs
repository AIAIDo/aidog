import { mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import { setTimeout as delay } from "timers/promises";
import { chromium } from "@playwright/test";
import { SQLiteStorage } from "../src/storage/index.js";
import { createRuleEngine } from "../src/rules/index.js";

const PORT = parseInt(process.env.AIDOG_SCREENSHOT_PORT || "9527", 10);
const SCREENSHOT_DIR = join(process.cwd(), "docs", "screenshots");
const LANGUAGES = [
  { code: "en", file: "dashboard-en.png" },
  { code: "zh-CN", file: "dashboard-zh-CN.png" },
  { code: "ja", file: "dashboard-ja.png" },
];
const PAGE_SHOTS = [
  { path: "/token-rules", key: "token-optimization" },
  { path: "/diagnostics", key: "diagnostics-analysis" },
  { path: "/performance", key: "performance-optimization" },
  { path: "/security", key: "security-scan" },
];

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await delay(500);
  }
  throw new Error(`Server did not become ready: ${url}`);
}

function seedDemoData(homeDir) {
  const storage = new SQLiteStorage(join(homeDir, ".aidog", "data.db"));
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const agents = [
    ["claude-code", "claude-sonnet-4-20250514"],
    ["codex", "gpt-4o"],
    ["gemini", "gemini-2.0-flash"],
  ];
  const events = [];

  for (let day = 0; day < 7; day += 1) {
    for (let slot = 0; slot < 3; slot += 1) {
      const [agent, model] = agents[(day + slot) % agents.length];
      const sessionId = `${agent}-sess-${day}-${slot}`;
      const base = now - day * dayMs - slot * 45 * 60 * 1000;

      events.push({
        id: `${sessionId}-user`,
        agent,
        sessionId,
        project: "aidog",
        timestamp: base,
        role: "user",
        model,
        inputTokens: 2200 + day * 180 + slot * 90,
        outputTokens: 0,
        cacheRead: 180 + slot * 30,
        cacheWrite: 140 + day * 20,
        toolCalls: [{ type: "tool_use", name: "read_file" }],
        content: [{ type: "text", text: `Investigate token efficiency regression for ${agent}.` }],
      });

      events.push({
        id: `${sessionId}-assistant`,
        agent,
        sessionId,
        project: "aidog",
        timestamp: base + 120000,
        role: "assistant",
        model,
        inputTokens: 920 + day * 70,
        outputTokens: 1080 + slot * 160,
        cacheRead: 120,
        cacheWrite: 0,
        toolCalls: [
          { type: "tool_use", name: slot % 2 === 0 ? "search" : "bash" },
          { type: "tool_use", name: "read_file" },
        ],
        content: [{ type: "text", text: `Summary for ${agent} session ${day}-${slot}.` }],
      });

      if (slot === 1) {
        events.push({
          id: `${sessionId}-assistant-2`,
          agent,
          sessionId,
          project: "aidog",
          timestamp: base + 240000,
          role: "assistant",
          model,
          inputTokens: 3800 + day * 300,
          outputTokens: 280,
          cacheRead: 0,
          cacheWrite: 0,
          toolCalls: Array.from({ length: 6 }, () => ({ type: "tool_use", name: "grep" })),
          content: [{ type: "text", text: "Repeated grep scans caused avoidable token burn." }],
        });
      }
    }
  }

  const noisySessionId = "codex-problem-session";
  const noisyBase = now - 3 * 60 * 60 * 1000;
  const noisyTurns = [
    { input: 1200, output: 260, tool: "grep" },
    { input: 1500, output: 290, tool: "grep" },
    { input: 1900, output: 320, tool: "grep" },
    { input: 2400, output: 340, tool: "grep" },
    { input: 3000, output: 380, tool: "grep" },
    { input: 3700, output: 420, tool: "grep" },
    { input: 4500, output: 460, tool: "grep" },
  ];

  noisyTurns.forEach((turn, index) => {
    const timestamp = noisyBase + index * 2 * 60 * 1000;
    events.push({
      id: `${noisySessionId}-user-${index}`,
      agent: "codex",
      sessionId: noisySessionId,
      project: "aidog",
      timestamp,
      role: "user",
      model: "o1",
      inputTokens: turn.input,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      toolCalls: [{ type: "tool_use", name: turn.tool }],
      content: [{ type: "text", text: `Retry attempt ${index + 1} to fix the same build failure.` }],
    });

    events.push({
      id: `${noisySessionId}-assistant-${index}`,
      agent: "codex",
      sessionId: noisySessionId,
      project: "aidog",
      timestamp: timestamp + 60_000,
      role: "assistant",
      model: "o1",
      inputTokens: 0,
      outputTokens: turn.output,
      cacheRead: 0,
      cacheWrite: 0,
      toolCalls: [{ type: "tool_use", name: turn.tool }],
      content: [{ type: "text", text: "The previous attempt failed. Repeating the same search path." }],
    });
  });

  storage.ingestEvents(events);
  const analysis = createRuleEngine().analyze(events);
  return Promise.resolve(analysis)
    .then((result) => {
      storage.saveAnalysisBatch(result);
      storage.close();
    });
}

async function captureScreenshots() {
  const browser = await chromium.launch({ headless: true });

  try {
    for (const { code, file } of LANGUAGES) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1400 },
      });
      const page = await context.newPage();

      await page.addInitScript((lang) => {
        window.localStorage.setItem("aidog-lang", lang);
        window.localStorage.setItem("aidog-theme", "dark");
      }, code);

      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: join(SCREENSHOT_DIR, file),
        fullPage: true,
      });

      for (const shot of PAGE_SHOTS) {
        await page.goto(`http://127.0.0.1:${PORT}${shot.path}`, { waitUntil: "networkidle" });
        await page.addStyleTag({
          content: `
            main > header {
              display: none !important;
            }
          `,
        });
        await delay(100);
        await page.screenshot({
          path: join(SCREENSHOT_DIR, `${shot.key}-${code}.png`),
          fullPage: true,
        });
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const homeDir = mkdtempSync(join(tmpdir(), "aidog-readme-"));
  await seedDemoData(homeDir);

  const server = spawn(
    "node",
    ["bin/aidog.js", "serve", "--port", String(PORT), "--no-watch", "--analyze-interval", "0"],
    {
      cwd: process.cwd(),
      env: { ...process.env, HOME: homeDir },
      stdio: "inherit",
    }
  );

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/api/stats?days=7&compact=1`);
    await captureScreenshots();
  } finally {
    server.kill("SIGTERM");
    await delay(1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
