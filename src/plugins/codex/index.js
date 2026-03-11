import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';
import { watch as chokidarWatch } from 'chokidar';
import { parseLine, parseJSONLFile } from './parser.js';

export class CodexPlugin {
  meta = {
    name: 'codex',
    displayName: 'Codex CLI',
    version: '0.1.0',
    homepage: 'https://platform.openai.com/docs/codex',
  };

  #getSessionsDir() {
    return path.join(homedir(), '.codex', 'sessions');
  }

  async isAvailable() {
    try {
      await fs.access(this.#getSessionsDir());
      return true;
    } catch {
      return false;
    }
  }

  async #findJSONLFiles(dir) {
    const results = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const nested = await this.#findJSONLFiles(fullPath);
          results.push(...nested);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          results.push(fullPath);
        }
      }
    } catch {
      // ignore directory read errors
    }
    return results;
  }

  async getDataPaths(since) {
    const files = await this.#findJSONLFiles(this.#getSessionsDir());
    if (!since) return files;

    const filtered = [];
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        if (stat.mtime >= since) filtered.push(file);
      } catch {
        // ignore file stat errors
      }
    }
    return filtered;
  }

  async fetchHistory(since) {
    const files = await this.getDataPaths(since);
    const allEvents = [];
    const seenIds = new Set();

    for (const file of files) {
      const events = await parseJSONLFile(file);
      for (const event of events) {
        if (since && event.timestamp < since) continue;
        if (seenIds.has(event.id)) continue;
        seenIds.add(event.id);
        allEvents.push(event);
      }
    }

    return allEvents;
  }

  watch(callback) {
    const sessionsDir = this.#getSessionsDir();
    const globPattern = path.join(sessionsDir, '**', '*.jsonl');
    const fileSizes = new Map();
    const fileStates = new Map();

    const watcher = chokidarWatch(globPattern, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    const handleChange = async (filePath) => {
      try {
        const stat = await fs.stat(filePath);
        const previousSize = fileSizes.get(filePath) || 0;
        if (stat.size <= previousSize) {
          fileSizes.set(filePath, stat.size);
          return;
        }

        const fileHandle = await fs.open(filePath, 'r');
        const deltaSize = stat.size - previousSize;
        const buffer = Buffer.alloc(deltaSize);
        await fileHandle.read(buffer, 0, deltaSize, previousSize);
        await fileHandle.close();

        fileSizes.set(filePath, stat.size);

        const state = fileStates.get(filePath) || {};
        const lines = buffer.toString('utf-8').split('\n');
        const events = [];

        for (let i = 0; i < lines.length; i++) {
          const ev = parseLine(lines[i], filePath, state, i + 1);
          if (ev) events.push(ev);
        }

        fileStates.set(filePath, state);
        if (events.length > 0) callback(events);
      } catch {
        // ignore watcher parse errors
      }
    };

    watcher.on('change', handleChange);
    watcher.on('add', handleChange);

    return () => {
      watcher.close();
    };
  }

  async getCurrentSession() {
    const files = await this.#findJSONLFiles(this.#getSessionsDir());
    if (files.length === 0) return null;

    let mostRecent = null;
    let mostRecentMtime = 0;
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        if (stat.mtimeMs > mostRecentMtime) {
          mostRecentMtime = stat.mtimeMs;
          mostRecent = file;
        }
      } catch {
        // ignore stat errors
      }
    }
    if (!mostRecent) return null;

    const events = await parseJSONLFile(mostRecent);
    if (events.length === 0) return null;

    const sessionId = events[events.length - 1].sessionId;
    const sessionEvents = events.filter((e) => e.sessionId === sessionId);
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    for (const event of sessionEvents) {
      usage.input_tokens += event.usage?.input_tokens || 0;
      usage.output_tokens += event.usage?.output_tokens || 0;
      usage.cache_creation_input_tokens += event.usage?.cache_creation_input_tokens || 0;
      usage.cache_read_input_tokens += event.usage?.cache_read_input_tokens || 0;
    }

    const first = sessionEvents[0];
    const last = sessionEvents[sessionEvents.length - 1];
    return {
      sessionId,
      project: first.projectName || first.projectPath || undefined,
      model: last.model,
      startedAt: first.timestamp,
      lastActivityAt: last.timestamp,
      eventCount: sessionEvents.length,
      usage,
    };
  }
}

