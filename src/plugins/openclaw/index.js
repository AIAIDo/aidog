import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';
import { watch as chokidarWatch } from 'chokidar';
import {
  findSessionStores,
  loadSessionIndex,
  parseAllEvents,
  parseJSONLFile,
} from './parser.js';

export class OpenClawPlugin {
  meta = {
    name: 'openclaw',
    displayName: 'OpenClaw',
    version: '0.1.0',
    homepage: 'https://openclaw.ai',
  };

  #getRootDir() {
    return process.env.AIDOG_OPENCLAW_HOME || path.join(homedir(), '.openclaw');
  }

  async isAvailable() {
    const stores = await findSessionStores(this.#getRootDir());
    return stores.length > 0;
  }

  async getDataPaths(since) {
    const stores = await findSessionStores(this.#getRootDir());
    const files = [];

    for (const store of stores) {
      files.push(store.indexPath);
      try {
        const entries = await fs.readdir(store.sessionsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            files.push(path.join(store.sessionsDir, entry.name));
          }
        }
      } catch {
        // ignore directory read failures
      }
    }

    if (!since) return files;

    const filtered = [];
    for (const filePath of files) {
      try {
        const stat = await fs.stat(filePath);
        if (stat.mtime >= since) filtered.push(filePath);
      } catch {
        // ignore stat failures
      }
    }
    return filtered;
  }

  async fetchHistory(since) {
    return parseAllEvents(this.#getRootDir(), since);
  }

  watch(callback) {
    const globPattern = path.join(this.#getRootDir(), 'agents', '**', 'sessions', '*.jsonl');
    const fileSizes = new Map();
    const sessionIndexCache = new Map();

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
        const sessionDir = path.dirname(filePath);

        if (!sessionIndexCache.has(sessionDir)) {
          sessionIndexCache.set(sessionDir, await loadSessionIndex(path.join(sessionDir, 'sessions.json')));
        }

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

        const lines = buffer.toString('utf-8').split('\n');
        const fileState = {};
        const { parseLine } = await import('./parser.js');
        const events = [];

        for (const [index, line] of lines.entries()) {
          const event = parseLine(
            line,
            filePath,
            fileState,
            sessionIndexCache.get(sessionDir),
            index + 1
          );
          if (event) events.push(event);
        }

        if (events.length > 0) callback(events);
      } catch {
        // ignore parse/watch failures
      }
    };

    watcher.on('change', handleChange);
    watcher.on('add', handleChange);

    return () => {
      watcher.close();
    };
  }

  async getCurrentSession() {
    const stores = await findSessionStores(this.#getRootDir());
    let best = null;

    for (const store of stores) {
      const sessionIndex = await loadSessionIndex(store.indexPath);
      for (const sessionMeta of sessionIndex.values()) {
        if (!best || sessionMeta.updatedAt > best.updatedAt) {
          best = { ...sessionMeta, sessionsDir: store.sessionsDir };
        }
      }
    }

    if (!best) return null;

    const transcriptPath = path.join(best.sessionsDir, `${best.sessionId}.jsonl`);
    const events = await parseJSONLFile(transcriptPath, new Map([[best.sessionId, best]]));
    const usage = best.usage || {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    if (
      usage.inputTokens === 0 &&
      usage.outputTokens === 0 &&
      usage.cacheReadTokens === 0 &&
      usage.cacheWriteTokens === 0
    ) {
      for (const event of events) {
        usage.inputTokens += event.inputTokens || 0;
        usage.outputTokens += event.outputTokens || 0;
        usage.cacheReadTokens += event.cacheReadTokens || 0;
        usage.cacheWriteTokens += event.cacheWriteTokens || 0;
      }
    }

    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];

    return {
      sessionId: best.sessionId,
      project: best.projectName || best.projectPath || null,
      model: lastEvent?.model || best.model || null,
      startedAt: firstEvent?.timestamp || new Date(best.createdAt || best.updatedAt || Date.now()),
      lastActivityAt: lastEvent?.timestamp || new Date(best.updatedAt || best.createdAt || Date.now()),
      eventCount: events.length,
      usage: {
        input_tokens: usage.inputTokens || 0,
        output_tokens: usage.outputTokens || 0,
        cache_creation_input_tokens: usage.cacheWriteTokens || 0,
        cache_read_input_tokens: usage.cacheReadTokens || 0,
      },
    };
  }
}
