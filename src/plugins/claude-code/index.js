import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';
import { watch as chokidarWatch } from 'chokidar';
import { parseJSONLFile } from './parser.js';

/**
 * Claude Code plugin for aidog.
 * Reads token usage data from Claude Code's local JSONL history files.
 *
 * @implements {import('../interface.js').AgentPlugin}
 */
export class ClaudeCodePlugin {
  meta = {
    name: 'claude-code',
    displayName: 'Claude Code',
    version: '1.0.0',
    homepage: 'https://claude.ai/code',
  };

  /**
   * Get the absolute path to the Claude projects directory.
   * @returns {string}
   */
  #getProjectsDir() {
    return path.join(homedir(), '.claude', 'projects');
  }

  /**
   * Check if Claude Code data is available on this system.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      await fs.access(this.#getProjectsDir());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get paths to raw JSONL data files for security scanning.
   * @param {Date} [since] - Only return files modified after this date
   * @returns {Promise<string[]>}
   */
  async getDataPaths(since) {
    const projectsDir = this.#getProjectsDir();
    const files = await this.#findJSONLFiles(projectsDir);

    if (!since) return files;

    // Filter by modification time
    const filtered = [];
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        if (stat.mtime >= since) {
          filtered.push(file);
        }
      } catch {
        // skip inaccessible files
      }
    }
    return filtered;
  }

  /**
   * Recursively find all .jsonl files under a directory.
   * @param {string} dir
   * @returns {Promise<string[]>}
   */
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
    } catch (err) {
      console.warn(`Failed to scan directory ${dir}: ${err.message}`);
    }

    return results;
  }

  /**
   * Fetch historical token events from all Claude Code JSONL files.
   *
   * @param {Date} [since] - Only return events after this date
   * @returns {Promise<import('../interface.js').TokenEvent[]>}
   */
  async fetchHistory(since) {
    const projectsDir = this.#getProjectsDir();
    const files = await this.#findJSONLFiles(projectsDir);

    const allEvents = [];
    const seenIds = new Set();

    for (const file of files) {
      const events = await parseJSONLFile(file);
      for (const event of events) {
        // Filter by date if provided
        if (since && event.timestamp < since) continue;
        // Deduplicate by event ID
        if (seenIds.has(event.id)) continue;
        seenIds.add(event.id);
        allEvents.push(event);
      }
    }

    return allEvents;
  }

  /**
   * Watch for new Claude Code JSONL data in real time.
   *
   * @param {(events: import('../interface.js').TokenEvent[]) => void} callback
   * @returns {() => void} Unsubscribe function
   */
  watch(callback) {
    const projectsDir = this.#getProjectsDir();
    const globPattern = path.join(projectsDir, '**', '*.jsonl');

    // Track file sizes to only parse new lines
    const fileSizes = new Map();

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

        // Read only the new portion of the file
        const fileHandle = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(stat.size - previousSize);
        await fileHandle.read(buffer, 0, buffer.length, previousSize);
        await fileHandle.close();

        fileSizes.set(filePath, stat.size);

        const newContent = buffer.toString('utf-8');
        const lines = newContent.split('\n');
        const { parseLine } = await import('./parser.js');

        const events = [];
        for (const line of lines) {
          const event = parseLine(line, filePath);
          if (event) events.push(event);
        }

        if (events.length > 0) {
          callback(events);
        }
      } catch (err) {
        console.warn(`Error processing file change ${filePath}: ${err.message}`);
      }
    };

    watcher.on('change', handleChange);
    watcher.on('add', handleChange);

    // Return unsubscribe function
    return () => {
      watcher.close();
    };
  }

  /**
   * Get the current (most recent) session state.
   *
   * @returns {Promise<Object|null>}
   */
  async getCurrentSession() {
    const projectsDir = this.#getProjectsDir();
    const files = await this.#findJSONLFiles(projectsDir);

    if (files.length === 0) return null;

    // Find most recently modified file
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
        // skip inaccessible files
      }
    }

    if (!mostRecent) return null;

    const events = await parseJSONLFile(mostRecent);
    if (events.length === 0) return null;

    // Get the last session ID from the file
    const lastEvent = events[events.length - 1];
    const sessionId = lastEvent.sessionId;

    // Filter events belonging to this session
    const sessionEvents = events.filter((e) => e.sessionId === sessionId);

    // Compute aggregate usage
    const totalUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    for (const event of sessionEvents) {
      totalUsage.input_tokens += event.usage.input_tokens;
      totalUsage.output_tokens += event.usage.output_tokens;
      totalUsage.cache_creation_input_tokens +=
        event.usage.cache_creation_input_tokens || 0;
      totalUsage.cache_read_input_tokens +=
        event.usage.cache_read_input_tokens || 0;
    }

    return {
      sessionId,
      project: lastEvent.project,
      model: lastEvent.model,
      startedAt: sessionEvents[0].timestamp,
      lastActivityAt: lastEvent.timestamp,
      eventCount: sessionEvents.length,
      usage: totalUsage,
    };
  }
}
