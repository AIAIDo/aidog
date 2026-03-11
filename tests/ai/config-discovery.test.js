import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigDiscovery } from '../../src/ai/config-discovery.js';

describe('ConfigDiscovery', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original environment variables
    process.env = { ...originalEnv };
  });

  describe('fromEnvVars', () => {
    it('should pick up ANTHROPIC_API_KEY from env', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const discovery = new ConfigDiscovery();
      const config = await discovery._fromEnvironment();

      expect(config).not.toBeNull();
      expect(config.anthropicApiKey).toBe('sk-ant-test-key');
    });

    it('should pick up OPENAI_API_KEY from env', async () => {
      process.env.OPENAI_API_KEY = 'sk-openai-test-key';

      const discovery = new ConfigDiscovery();
      const config = await discovery._fromEnvironment();

      expect(config).not.toBeNull();
      expect(config.openaiApiKey).toBe('sk-openai-test-key');
    });

    it('should pick up GEMINI_API_KEY from env', async () => {
      process.env.GEMINI_API_KEY = 'gemini-test-key';

      const discovery = new ConfigDiscovery();
      const config = await discovery._fromEnvironment();

      expect(config).not.toBeNull();
      expect(config.geminiApiKey).toBe('gemini-test-key');
    });

    it('should pick up AIDOG_AI_PROVIDER and AIDOG_AI_MODEL from env', async () => {
      process.env.AIDOG_AI_PROVIDER = 'openai';
      process.env.AIDOG_AI_MODEL = 'gpt-4o';

      const discovery = new ConfigDiscovery();
      const config = await discovery._fromEnvironment();

      expect(config).not.toBeNull();
      expect(config.preferredProvider).toBe('openai');
      expect(config.preferredModel).toBe('gpt-4o');
    });

    it('should return null when no relevant env vars are set', async () => {
      // Remove all relevant env vars
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.OPENAI_COMPATIBLE_API_KEY;
      delete process.env.OPENAI_COMPATIBLE_BASE_URL;
      delete process.env.AIDOG_AI_PROVIDER;
      delete process.env.AIDOG_AI_MODEL;

      const discovery = new ConfigDiscovery();
      const config = await discovery._fromEnvironment();

      expect(config).toBeNull();
    });
  });

  describe('discover', () => {
    it('should merge sources with environment taking priority', async () => {
      process.env.ANTHROPIC_API_KEY = 'env-key';

      const discovery = new ConfigDiscovery();
      const config = await discovery.discover();

      // Environment key should be present
      expect(config.anthropicApiKey).toBe('env-key');
    });

    it('should return an object even when no sources have config', async () => {
      // Clear relevant env vars
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.OPENAI_COMPATIBLE_API_KEY;
      delete process.env.OPENAI_COMPATIBLE_BASE_URL;
      delete process.env.AIDOG_AI_PROVIDER;
      delete process.env.AIDOG_AI_MODEL;

      const discovery = new ConfigDiscovery();
      const config = await discovery.discover();

      expect(typeof config).toBe('object');
    });

    it('should pick up GOOGLE_API_KEY as geminiApiKey', async () => {
      process.env.GOOGLE_API_KEY = 'google-key';
      delete process.env.GEMINI_API_KEY;

      const discovery = new ConfigDiscovery();
      const config = await discovery._fromEnvironment();

      expect(config.geminiApiKey).toBe('google-key');
    });

    it('should prefer GEMINI_API_KEY over GOOGLE_API_KEY', async () => {
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.GOOGLE_API_KEY = 'google-key';

      const discovery = new ConfigDiscovery();
      const config = await discovery._fromEnvironment();

      expect(config.geminiApiKey).toBe('gemini-key');
    });
  });
});
