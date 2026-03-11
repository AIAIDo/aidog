import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * CLI agent definitions: command name and argument builder.
 * Priority order determines which agent is preferred when multiple are available.
 */
const CLI_AGENTS = [
  { name: 'claude',   cmd: 'claude',   args: (prompt) => ['-p', prompt] },
  { name: 'gemini',   cmd: 'gemini',   args: (prompt) => ['-p', prompt] },
  { name: 'codex',    cmd: 'codex',    args: (prompt) => ['exec', prompt] },
  { name: 'opencode', cmd: 'opencode', args: (prompt) => ['run', prompt] },
];

/**
 * CliAdapter - AI adapter that calls installed agent CLIs directly.
 *
 * Leverages the user's existing CLI authentication (subscription, OAuth, browser login)
 * so no separate API key configuration is needed.
 */
export class CliAdapter {
  meta = {
    name: 'cli',
    displayName: 'Agent CLI',
    requiresApiKey: false,
    supportsStreaming: true,
    isLocal: true,
  };

  constructor(config = {}) {
    this.timeoutMs = config.timeoutMs || 120_000;
    this.preferredAgent = config.agent || null;
    this._spawn = config.spawn || spawn;
    /** @type {string|null} cached detected agent name */
    this._detected = null;
  }

  /**
   * Check if any supported agent CLI is installed and on PATH.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    const agent = await this._detectAgent();
    return agent !== null;
  }

  /**
   * Run analysis by calling the first available agent CLI.
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {Object} [options]
   * @returns {Promise<string>} The CLI response text
   */
  async analyze(systemPrompt, userPrompt, options = {}) {
    const agent = await this._detectAgent();
    if (!agent) {
      throw new Error(
        'No agent CLI found. Install one of: claude, gemini, codex, opencode'
      );
    }

    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    const args = agent.args(prompt);
    const env = { ...process.env };
    delete env.CLAUDECODE;

    return await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;

      const child = this._spawn(agent.cmd, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const finish = (err, output) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(output);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, this.timeoutMs);

      child.once('error', (err) => {
        finish(new Error(`${agent.name} CLI error: ${err.message}`));
      });

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');

      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
        if (typeof options.onChunk === 'function') {
          options.onChunk(chunk);
        }
      });

      child.stderr?.on('data', (chunk) => {
        stderr += chunk;
      });

      child.once('close', (code, signal) => {
        if (timedOut || signal === 'SIGTERM') {
          finish(new Error(`${agent.name} CLI timed out after ${this.timeoutMs / 1000}s`));
          return;
        }

        if (code !== 0) {
          const detail = stderr.trim() || `exit code ${code}`;
          finish(new Error(`${agent.name} CLI error: ${detail.slice(0, 500)}`));
          return;
        }

        const output = stdout.trim();
        if (!output) {
          const detail = stderr.trim();
          if (detail) {
            finish(new Error(`${agent.name} CLI returned no output. stderr: ${detail.slice(0, 500)}`));
            return;
          }
        }

        finish(null, output);
      });
    });
  }

  /**
   * Detect the first available agent CLI in priority order.
   * @private
   * @returns {Promise<Object|null>} The agent config object, or null
   */
  async _detectAgent() {
    if (this._detected) {
      return CLI_AGENTS.find((a) => a.name === this._detected) || null;
    }

    // If a preferred agent is specified, check it first
    if (this.preferredAgent) {
      const preferred = CLI_AGENTS.find((a) => a.name === this.preferredAgent);
      if (preferred && await this._cmdExists(preferred.cmd)) {
        this._detected = preferred.name;
        return preferred;
      }
    }

    // Check all agents in priority order
    for (const agent of CLI_AGENTS) {
      if (await this._cmdExists(agent.cmd)) {
        this._detected = agent.name;
        return agent;
      }
    }

    return null;
  }

  /**
   * Check if a command exists on PATH.
   * @private
   * @param {string} cmd
   * @returns {Promise<boolean>}
   */
  async _cmdExists(cmd) {
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      await execFileAsync(which, [cmd], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
