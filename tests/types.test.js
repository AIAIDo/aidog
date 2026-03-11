import { describe, it, expect } from 'vitest';
import { createTokenEvent, createRuleResult } from '../src/types.js';

describe('createTokenEvent', () => {
  it('should create event with minimal required fields', () => {
    const event = createTokenEvent({
      agentName: 'claude-code',
      sourceMessageId: 'msg_abc123',
    });

    expect(event.id).toBe('claude-code:msg_abc123');
    expect(event.agentName).toBe('claude-code');
    expect(event.sourceMessageId).toBe('msg_abc123');
  });

  it('should generate id from agentName + sourceMessageId', () => {
    const event = createTokenEvent({
      agentName: 'aider',
      sourceMessageId: 'msg_xyz789',
    });

    expect(event.id).toBe('aider:msg_xyz789');
  });

  it('should apply default values for optional fields', () => {
    const event = createTokenEvent({
      agentName: 'claude-code',
      sourceMessageId: 'msg_001',
    });

    expect(event.sessionId).toBe('');
    expect(event.projectPath).toBe('');
    expect(event.projectName).toBe('');
    expect(event.role).toBe('assistant');
    expect(event.model).toBe('');
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
    expect(event.cacheReadTokens).toBe(0);
    expect(event.cacheWriteTokens).toBe(0);
    expect(event.toolCalls).toEqual([]);
    expect(event.contentLength).toBe(0);
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it('should create event with all fields provided', () => {
    const now = new Date('2025-01-15T10:00:00Z');
    const event = createTokenEvent({
      agentName: 'claude-code',
      sourceMessageId: 'msg_full',
      sessionId: 'session-1',
      projectPath: '/home/user/project',
      projectName: 'my-project',
      timestamp: now,
      role: 'user',
      model: 'claude-sonnet-4-20250514',
      inputTokens: 5000,
      outputTokens: 2000,
      cacheReadTokens: 1000,
      cacheWriteTokens: 500,
      toolCalls: [{ type: 'tool_use', name: 'Read', inputSize: 50, outputSize: 200 }],
      contentLength: 300,
      raw: { original: true },
    });

    expect(event.id).toBe('claude-code:msg_full');
    expect(event.sessionId).toBe('session-1');
    expect(event.projectPath).toBe('/home/user/project');
    expect(event.projectName).toBe('my-project');
    expect(event.timestamp).toBe(now);
    expect(event.role).toBe('user');
    expect(event.model).toBe('claude-sonnet-4-20250514');
    expect(event.inputTokens).toBe(5000);
    expect(event.outputTokens).toBe(2000);
    expect(event.cacheReadTokens).toBe(1000);
    expect(event.cacheWriteTokens).toBe(500);
    expect(event.toolCalls).toHaveLength(1);
    expect(event.toolCalls[0].name).toBe('Read');
    expect(event.contentLength).toBe(300);
    expect(event.raw).toEqual({ original: true });
  });

  it('should not include raw field when not provided', () => {
    const event = createTokenEvent({
      agentName: 'claude-code',
      sourceMessageId: 'msg_noraw',
    });

    expect(event).not.toHaveProperty('raw');
  });
});

describe('createRuleResult', () => {
  it('should create result with minimal required fields', () => {
    const result = createRuleResult({ ruleId: 'R1_context_growth' });

    expect(result.ruleId).toBe('R1_context_growth');
  });

  it('should apply default values for optional fields', () => {
    const result = createRuleResult({ ruleId: 'R2_tool_loop' });

    expect(result.severity).toBe('low');
    expect(result.triggered).toBe(false);
    expect(result.occurrences).toBe(0);
    expect(result.detail).toEqual({});
    expect(result.estimatedWastedTokens).toBe(0);
    expect(result.evidence).toEqual([]);
  });

  it('should create result with all fields provided', () => {
    const result = createRuleResult({
      ruleId: 'R1_context_growth',
      severity: 'high',
      triggered: true,
      occurrences: 5,
      detail: { growthRatio: 3.5 },
      estimatedWastedTokens: 50000,
      evidence: [
        {
          eventId: 'evt-1',
          sessionId: 'sess-1',
          turnIndex: 3,
          timestamp: Date.now(),
          inputTokens: 10000,
          outputTokens: 500,
          wastedTokens: 8000,
          reason: 'Context grew excessively',
        },
      ],
    });

    expect(result.ruleId).toBe('R1_context_growth');
    expect(result.severity).toBe('high');
    expect(result.triggered).toBe(true);
    expect(result.occurrences).toBe(5);
    expect(result.detail.growthRatio).toBe(3.5);
    expect(result.estimatedWastedTokens).toBe(50000);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].eventId).toBe('evt-1');
  });
});
