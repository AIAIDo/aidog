import { describe, it, expect } from 'vitest';
import R12 from '../../src/rules/rules/R12-model-mismatch.js';

function createMockEvent(overrides = {}) {
  return {
    id: `openclaw:msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'openclaw-session',
    timestamp: Date.now(),
    role: 'assistant',
    model: 'gpt-4o',
    inputTokens: 300,
    outputTokens: 100,
    toolCalls: [],
    ...overrides,
  };
}

describe('OpenClaw rule mappings', () => {
  it('should treat expensive models as mismatches for small OpenClaw turns', () => {
    const result = R12.check(
      [createMockEvent({ model: 'gpt-4o', inputTokens: 400, outputTokens: 120 })],
      { sessionId: 'sess-1', agent: 'openclaw' }
    );

    expect(result).not.toBeNull();
    expect(result.detail.modelsUsed).toContain('gpt-4o');
  });
});
