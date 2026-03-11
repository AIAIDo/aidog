import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';
import { watch as chokidarWatch } from 'chokidar';
import { parseSessionFile } from './parser.js';

export class GeminiPlugin {
  meta = {
    name: 'gemini',
    displayName: 'Gemini CLI',
    version: '0.1.0',
    homepage: 'https://github.com/google-gemini/gemini-cli',
  };

  #getDataDir() {
    return path.join(homedir(), '.gemini', 'tmp');
  }

  #getProjectsFile() {
    return path.join(homedir(), '.gemini', 'projects.json');
  }

  /**
   * Load project hash → name mapping from ~/.gemini/projects.json.
   * The file maps project paths to display names; we also index by
   * the directory names used under tmp/ (which can be hashes or names).
   */
  async #loadProjectMap() {
    const map = new Map();
    try {
      const data = await fs.readFile(this.#getProjectsFile(), 'utf-8');
      const parsed = JSON.parse(data);
      const projects = parsed.projects || parsed;
      if (typeof projects === 'object') {
        for (const [projectPath, name] of Object.entries(projects)) {
          // Map the display name by name itself (for named dirs like "gosnip")
          map.set(name, name);
          // Also store path → name for reverse lookup if needed
          map.set(projectPath, name);
        }
      }
    } catch {
      // projects.json not found or invalid
    }
    return map;
  }

  async isAvailable() {
    try {
      await fs.access(this.#getDataDir());
      return true;
    } catch {
      return false;
    }
  }

  async #findSessionFiles(dir) {
    const results = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const nested = await this.#findSessionFiles(fullPath);
          results.push(...nested);
        } else if (entry.isFile() && entry.name.startsWith('session-') && entry.name.endsWith('.json')) {
          results.push(fullPath);
        }
      }
    } catch {
      // ignore directory read errors
    }
    return results;
  }

  /**
   * Extract the project directory name from a session file path.
   * e.g. ~/.gemini/tmp/gosnip/chats/session-xxx.json → "gosnip"
   */
  #extractProjectDir(filePath) {
    const dataDir = this.#getDataDir();
    const relative = path.relative(dataDir, filePath);
    const parts = relative.split(path.sep);
    return parts.length > 0 ? parts[0] : undefined;
  }

  async getDataPaths(since) {
    const files = await this.#findSessionFiles(this.#getDataDir());
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
    const projectMap = await this.#loadProjectMap();
    const allEvents = [];
    const seenIds = new Set();

    for (const file of files) {
      const projectDir = this.#extractProjectDir(file);
      const projectName = projectMap.get(projectDir) || projectDir;
      const events = await parseSessionFile(file, projectName);

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
    const dataDir = this.#getDataDir();
    const globPattern = path.join(dataDir, '**', 'session-*.json');
    const seenMessageIds = new Set();

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
        const projectDir = this.#extractProjectDir(filePath);
        const events = await parseSessionFile(filePath, projectDir);
        const newEvents = events.filter((e) => {
          if (seenMessageIds.has(e.id)) return false;
          seenMessageIds.add(e.id);
          return true;
        });

        if (newEvents.length > 0) callback(newEvents);
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
    const files = await this.#findSessionFiles(this.#getDataDir());
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

    const projectDir = this.#extractProjectDir(mostRecent);
    const events = await parseSessionFile(mostRecent, projectDir);
    if (events.length === 0) return null;

    const sessionId = events[0].sessionId;
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    for (const event of events) {
      usage.input_tokens += event.usage?.input_tokens || 0;
      usage.output_tokens += event.usage?.output_tokens || 0;
      usage.cache_creation_input_tokens += event.usage?.cache_creation_input_tokens || 0;
      usage.cache_read_input_tokens += event.usage?.cache_read_input_tokens || 0;
    }

    const first = events[0];
    const last = events[events.length - 1];
    return {
      sessionId,
      project: first.projectName || undefined,
      model: last.model,
      startedAt: first.timestamp,
      lastActivityAt: last.timestamp,
      eventCount: events.length,
      usage,
    };
  }
}
