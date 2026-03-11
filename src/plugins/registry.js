import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';
import { validatePlugin } from './interface.js';
import { ClaudeCodePlugin } from './claude-code/index.js';
import { AiderPlugin } from './aider/index.js';
import { OpenCodePlugin } from './opencode/index.js';
import { CodexPlugin } from './codex/index.js';
import { GeminiPlugin } from './gemini/index.js';
import { OpenClawPlugin } from './openclaw/index.js';

/**
 * Plugin registry that manages built-in and user plugins.
 */
export class PluginRegistry {
  /** @type {Map<string, import('./interface.js').AgentPlugin>} */
  #plugins = new Map();

  constructor() {
    // Register built-in plugins
    this.#register(new ClaudeCodePlugin());
    this.#register(new CodexPlugin());
    this.#register(new GeminiPlugin());
    this.#register(new AiderPlugin());
    this.#register(new OpenCodePlugin());
    this.#register(new OpenClawPlugin());
  }

  /**
   * Register a plugin after validating it.
   * @param {import('./interface.js').AgentPlugin} plugin
   */
  #register(plugin) {
    const { valid, errors } = validatePlugin(plugin);
    if (!valid) {
      console.warn(
        `Skipping invalid plugin: ${errors.join(', ')}`
      );
      return;
    }
    this.#plugins.set(plugin.meta.name, plugin);
  }

  /**
   * Load user plugins from ~/.aidog/plugins/ directory.
   * Each subdirectory should contain an index.js that default-exports a plugin instance.
   */
  async loadUserPlugins() {
    const userPluginDir = path.join(homedir(), '.aidog', 'plugins');

    try {
      const entries = await fs.readdir(userPluginDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginPath = path.join(userPluginDir, entry.name, 'index.js');

        try {
          await fs.access(pluginPath);
          const mod = await import(pluginPath);
          const plugin = mod.default || mod;

          if (this.#plugins.has(plugin?.meta?.name)) {
            console.warn(
              `User plugin "${entry.name}" conflicts with existing plugin "${plugin.meta.name}", skipping`
            );
            continue;
          }

          this.#register(plugin);
        } catch (err) {
          console.warn(
            `Failed to load user plugin "${entry.name}": ${err.message}`
          );
        }
      }
    } catch {
      // ~/.aidog/plugins/ doesn't exist — that's fine
    }
  }

  /**
   * Get all registered plugins.
   * @returns {import('./interface.js').AgentPlugin[]}
   */
  getAll() {
    return [...this.#plugins.values()];
  }

  /**
   * Get a plugin by its name.
   * @param {string} name
   * @returns {import('./interface.js').AgentPlugin | undefined}
   */
  getByName(name) {
    return this.#plugins.get(name);
  }

  /**
   * Get only plugins whose agent data is available on this system.
   * @returns {Promise<import('./interface.js').AgentPlugin[]>}
   */
  async getAvailable() {
    const results = await Promise.all(
      this.getAll().map(async (plugin) => {
        try {
          const available = await plugin.isAvailable();
          return available ? plugin : null;
        } catch {
          return null;
        }
      })
    );
    return results.filter(Boolean);
  }
}
