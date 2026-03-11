import path from 'path';
import fs from 'fs/promises';
import { watch as chokidarWatch } from 'chokidar';
import {
  getStorageDir,
  loadProjectMap,
  loadSessions,
  loadPartsForMessage,
  extractToolCalls,
  messageToTokenEvent,
  parseAllEvents,
} from './parser.js';

/**
 * OpenCode plugin for aidog.
 * Reads session data from ~/.local/share/opencode/storage/.
 *
 * @implements {import('../interface.js').AgentPlugin}
 */
export class OpenCodePlugin {
  meta = {
    name: 'opencode',
    displayName: 'OpenCode',
    version: '0.1.0',
    homepage: 'https://opencode.ai',
  };

  #getStorageDir() {
    return getStorageDir();
  }

  async isAvailable() {
    try {
      await fs.access(path.join(this.#getStorageDir(), 'session'));
      return true;
    } catch {
      return false;
    }
  }

  async #findMessageFiles(dir) {
    const results = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const nested = await this.#findMessageFiles(fullPath);
          results.push(...nested);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          results.push(fullPath);
        }
      }
    } catch {
      // ignore directory read errors
    }
    return results;
  }

  async getDataPaths(since) {
    const msgDir = path.join(this.#getStorageDir(), 'message');
    const files = await this.#findMessageFiles(msgDir);
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
    const storageDir = this.#getStorageDir();
    return parseAllEvents(storageDir, since);
  }

  watch(callback) {
    const storageDir = this.#getStorageDir();
    const globPattern = path.join(storageDir, 'message', '**', '*.json');
    const seenMessageIds = new Set();

    // Cache project map and sessions to avoid re-reading on every file change
    let projectMapPromise = null;
    let sessionsCache = new Map();

    const getProjectMap = () => {
      if (!projectMapPromise) {
        projectMapPromise = loadProjectMap(storageDir);
      }
      return projectMapPromise;
    };

    const getSessionInfo = async (sessionId) => {
      if (sessionsCache.has(sessionId)) return sessionsCache.get(sessionId);
      const projectMap = await getProjectMap();
      const sessions = await loadSessions(storageDir, projectMap);
      sessionsCache = sessions;
      return sessions.get(sessionId);
    };

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
        const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        if (!data || !data.id || data.role !== 'assistant') return;

        const eventId = `opencode:${data.id}`;
        if (seenMessageIds.has(eventId)) return;
        seenMessageIds.add(eventId);

        const sessionInfo = await getSessionInfo(data.sessionID);
        const parts = await loadPartsForMessage(storageDir, data.id);
        const toolCalls = extractToolCalls(parts);
        const event = messageToTokenEvent(data, sessionInfo, toolCalls);

        callback([event]);
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
    const storageDir = this.#getStorageDir();
    const projectMap = await loadProjectMap(storageDir);
    const sessions = await loadSessions(storageDir, projectMap);

    if (sessions.size === 0) return null;

    // Find the most recently updated session
    let mostRecent = null;
    let mostRecentTime = 0;
    for (const [, session] of sessions) {
      const t = session.updatedAt || session.createdAt || 0;
      if (t > mostRecentTime) {
        mostRecentTime = t;
        mostRecent = session;
      }
    }
    if (!mostRecent) return null;

    const events = await parseAllEvents(storageDir);
    const sessionEvents = events.filter((e) => e.sessionId === mostRecent.id);
    if (sessionEvents.length === 0) return null;

    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    for (const event of sessionEvents) {
      usage.input_tokens += event.inputTokens || 0;
      usage.output_tokens += event.outputTokens || 0;
      usage.cache_creation_input_tokens += event.cacheWriteTokens || 0;
      usage.cache_read_input_tokens += event.cacheReadTokens || 0;
    }

    const first = sessionEvents[0];
    const last = sessionEvents[sessionEvents.length - 1];
    return {
      sessionId: mostRecent.id,
      project: mostRecent.projectName || undefined,
      model: last.model,
      startedAt: first.timestamp,
      lastActivityAt: last.timestamp,
      eventCount: sessionEvents.length,
      usage,
    };
  }
}
