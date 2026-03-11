import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../src/ai/prompt-builder.js';

describe('PromptBuilder', () => {
  let builder;

  beforeEach(() => {
    builder = new PromptBuilder();
  });

  describe('buildSystemPrompt', () => {
    it('should return a non-empty string', () => {
      const prompt = builder.buildSystemPrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should contain optimization-related content', () => {
      const prompt = builder.buildSystemPrompt();
      expect(prompt).toContain('token');
    });
  });

  describe('buildUserPrompt', () => {
    it('should include analysis data in the prompt', () => {
      const analysisData = {
        totalTokens: 100000,
        totalWasted: 20000,
        healthScore: { score: 75, grade: 'B' },
        rules: [{ ruleId: 'R1_context_growth', severity: 'high' }],
      };

      const prompt = builder.buildUserPrompt(analysisData);
      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('100000');
      expect(prompt).toContain('R1_context_growth');
    });

    it('should serialize analysis data as JSON', () => {
      const analysisData = { key: 'value', nested: { a: 1 } };
      const prompt = builder.buildUserPrompt(analysisData);
      expect(prompt).toContain('"key"');
      expect(prompt).toContain('"value"');
    });
  });

  describe('build', () => {
    const analysisData = {
      totalTokens: 50000,
      issues: ['context growth'],
    };

    it('should build prompts for claude provider', () => {
      const result = builder.build('claude', analysisData);
      expect(result).toHaveProperty('systemPrompt');
      expect(result).toHaveProperty('userPrompt');
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.userPrompt.length).toBeGreaterThan(0);
    });

    it('should build prompts for openai provider with JSON instruction', () => {
      const result = builder.build('openai', analysisData);
      expect(result.systemPrompt).toContain('JSON');
    });

    it('should build prompts for ollama provider with simplified system prompt', () => {
      const result = builder.build('ollama', analysisData);
      expect(result.systemPrompt).toContain('token');
      expect(result.systemPrompt).toContain('JSON');
    });

    it('should build prompts for gemini provider', () => {
      const result = builder.build('gemini', analysisData);
      expect(result.systemPrompt).toContain('JSON');
      expect(result.userPrompt).toContain('JSON');
    });

    it('should fall back to default prompts for unknown provider', () => {
      const result = builder.build('unknown-provider', analysisData);
      expect(result).toHaveProperty('systemPrompt');
      expect(result).toHaveProperty('userPrompt');
    });

    it('should include analysis data in userPrompt for all providers', () => {
      const providers = ['claude', 'openai', 'ollama', 'gemini', 'compatible'];
      for (const provider of providers) {
        const result = builder.build(provider, analysisData);
        expect(result.userPrompt).toContain('50000');
      }
    });
  });
});
