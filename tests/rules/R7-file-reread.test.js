import { describe, it, expect } from 'vitest';
import R7 from '../../src/rules/rules/R7-file-reread.js';

describe('R7 with storage event shape', () => {
  it('triggers when same file read >2 times via toolCalls', () => {
    const now = Date.now();
    const events = Array.from({ length: 4 }, (_, i) => ({
      id: `msg_${i}`, sessionId: 'sess-1',
      timestamp: now + i * 1000,
      inputTokens: 500, outputTokens: 2000,
      toolCalls: [{ name: 'Read', input: { file_path: '/src/app.js' } }],
    }));
    const result = R7.check(events, { sessionId: 'sess-1' });
    expect(result?.triggered).toBe(true);
  });
});
