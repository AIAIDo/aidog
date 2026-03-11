import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';

/**
 * ConfigDiscovery - Auto-detects API keys and configuration from various sources.
 *
 * Priority order:
 *   1. Environment variables (highest)
 *   2. Claude Code settings (~/.claude/settings.json)
 *   3. Aider config (~/.aider.conf.yml)
 *   4. AWS credentials (~/.aws/credentials)
 *   5. GCloud config (~/.config/gcloud/)
 */
export class ConfigDiscovery {
  constructor() {
    this.home = homedir();
  }

  /**
   * Auto-detect API keys and configuration from all known sources.
   * @returns {Promise<Object>} Merged config object
   */
  async discover() {
    const sources = await Promise.allSettled([
      this._fromEnvironment(),
      this._fromClaudeSettings(),
      this._fromAiderConfig(),
      this._fromAwsCredentials(),
      this._fromGcloudConfig(),
    ]);

    // Merge results, earlier sources take priority
    const config = {};

    // Process in reverse order so higher-priority sources overwrite
    for (let i = sources.length - 1; i >= 0; i--) {
      if (sources[i].status === 'fulfilled' && sources[i].value) {
        Object.assign(config, sources[i].value);
      }
    }

    return config;
  }

  /**
   * Read API keys from environment variables.
   * @private
   */
  async _fromEnvironment() {
    const config = {};

    if (process.env.ANTHROPIC_API_KEY) {
      config.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    }
    if (process.env.OPENAI_API_KEY) {
      config.openaiApiKey = process.env.OPENAI_API_KEY;
    }
    if (process.env.GEMINI_API_KEY) {
      config.geminiApiKey = process.env.GEMINI_API_KEY;
    }
    if (process.env.GOOGLE_API_KEY) {
      config.geminiApiKey = config.geminiApiKey || process.env.GOOGLE_API_KEY;
    }
    if (process.env.OPENAI_COMPATIBLE_API_KEY) {
      config.compatibleApiKey = process.env.OPENAI_COMPATIBLE_API_KEY;
    }
    if (process.env.OPENAI_COMPATIBLE_BASE_URL) {
      config.compatibleBaseURL = process.env.OPENAI_COMPATIBLE_BASE_URL;
    }
    if (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY) {
      config.kimiApiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
    }
    if (process.env.KIMI_BASE_URL || process.env.MOONSHOT_BASE_URL) {
      config.kimiBaseURL = process.env.KIMI_BASE_URL || process.env.MOONSHOT_BASE_URL;
    }
    if (process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY) {
      config.glmApiKey = process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY;
    }
    if (process.env.GLM_BASE_URL || process.env.ZHIPU_BASE_URL) {
      config.glmBaseURL = process.env.GLM_BASE_URL || process.env.ZHIPU_BASE_URL;
    }
    if (process.env.MINMAX_API_KEY || process.env.MINIMAX_API_KEY) {
      config.minmaxApiKey = process.env.MINMAX_API_KEY || process.env.MINIMAX_API_KEY;
    }
    if (process.env.MINMAX_BASE_URL || process.env.MINIMAX_BASE_URL) {
      config.minmaxBaseURL = process.env.MINMAX_BASE_URL || process.env.MINIMAX_BASE_URL;
    }
    if (process.env.QODER_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY) {
      config.qoderApiKey = process.env.QODER_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    }
    if (process.env.QODER_BASE_URL || process.env.DASHSCOPE_BASE_URL) {
      config.qoderBaseURL = process.env.QODER_BASE_URL || process.env.DASHSCOPE_BASE_URL;
    }
    if (process.env.AIDOG_AI_PROVIDER) {
      config.preferredProvider = process.env.AIDOG_AI_PROVIDER;
    }
    if (process.env.AIDOG_AI_MODEL) {
      config.preferredModel = process.env.AIDOG_AI_MODEL;
    }

    return Object.keys(config).length > 0 ? config : null;
  }

  /**
   * Read API keys from Claude Code settings.
   * @private
   */
  async _fromClaudeSettings() {
    try {
      const settingsPath = join(this.home, '.claude', 'settings.json');
      const content = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      const config = {};

      // Claude Code may store env vars or API keys in settings
      if (settings.env?.ANTHROPIC_API_KEY) {
        config.anthropicApiKey = settings.env.ANTHROPIC_API_KEY;
      }
      if (settings.env?.OPENAI_API_KEY) {
        config.openaiApiKey = settings.env.OPENAI_API_KEY;
      }
      if (settings.apiKey) {
        config.anthropicApiKey = settings.apiKey;
      }

      return Object.keys(config).length > 0 ? config : null;
    } catch {
      return null;
    }
  }

  /**
   * Read API keys from Aider configuration.
   * @private
   */
  async _fromAiderConfig() {
    try {
      const configPath = join(this.home, '.aider.conf.yml');
      const content = await readFile(configPath, 'utf-8');
      const aiderConfig = yaml.load(content);

      if (!aiderConfig || typeof aiderConfig !== 'object') {
        return null;
      }

      const config = {};

      if (aiderConfig['openai-api-key']) {
        config.openaiApiKey = aiderConfig['openai-api-key'];
      }
      if (aiderConfig['anthropic-api-key']) {
        config.anthropicApiKey = aiderConfig['anthropic-api-key'];
      }
      if (aiderConfig['api-key']) {
        config.openaiApiKey = config.openaiApiKey || aiderConfig['api-key'];
      }

      return Object.keys(config).length > 0 ? config : null;
    } catch {
      return null;
    }
  }

  /**
   * Check for AWS credentials (for Bedrock access).
   * @private
   */
  async _fromAwsCredentials() {
    try {
      const credentialsPath = join(this.home, '.aws', 'credentials');
      const content = await readFile(credentialsPath, 'utf-8');

      // Simple INI parsing for default profile
      const lines = content.split('\n');
      let inDefault = false;
      const config = {};

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '[default]') {
          inDefault = true;
          continue;
        }
        if (trimmed.startsWith('[')) {
          inDefault = false;
          continue;
        }
        if (inDefault && trimmed.includes('=')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').trim();
          if (key.trim() === 'aws_access_key_id') {
            config.awsAccessKeyId = value;
          }
          if (key.trim() === 'aws_secret_access_key') {
            config.awsSecretAccessKey = value;
          }
          if (key.trim() === 'region') {
            config.awsRegion = value;
          }
        }
      }

      if (config.awsAccessKeyId) {
        config.awsAvailable = true;
      }

      return Object.keys(config).length > 0 ? config : null;
    } catch {
      return null;
    }
  }

  /**
   * Check for GCloud configuration.
   * @private
   */
  async _fromGcloudConfig() {
    try {
      const configPath = join(this.home, '.config', 'gcloud', 'properties');
      const content = await readFile(configPath, 'utf-8');

      const config = {};

      // Simple INI parsing
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.includes('=')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').trim();
          if (key.trim() === 'project') {
            config.gcpProject = value;
          }
        }
      }

      if (Object.keys(config).length > 0) {
        config.gcpAvailable = true;
      }

      return Object.keys(config).length > 0 ? config : null;
    } catch {
      return null;
    }
  }
}
