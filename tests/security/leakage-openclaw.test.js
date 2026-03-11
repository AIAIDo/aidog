import { describe, it, expect, afterEach } from 'vitest';
import { LeakageScanner } from '../../src/security/leakage/index.js';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('LeakageScanner OpenClaw compatibility', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('should scan OpenClaw toolCall arguments for secrets', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidog-openclaw-leakage-'));
    const filePath = join(tmpDir, 'openclaw.jsonl');
    const scanner = new LeakageScanner();

    writeFileSync(filePath, JSON.stringify({
      type: 'message',
      id: 'msg_tool_call',
      sessionId: 'sess-openclaw',
      timestamp: '2026-02-18T05:01:21.729Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'tool_exec_1',
            name: 'exec',
            arguments: {
              command: 'git clone https://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@github.com/org/repo.git',
            },
          },
        ],
      },
    }));

    const result = await scanner.scan([filePath]);
    expect(result.findings.some((f) => f.ruleId === 'S7')).toBe(true);

    const finding = result.findings.find((f) => f.ruleId === 'S7');
    expect(finding.sessionId).toBe('sess-openclaw');
    expect(finding.messageId).toBe('msg_tool_call');
    expect(finding.source).toBe('tool_input');
  });

  it('should scan OpenClaw toolResult messages for sensitive output', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidog-openclaw-leakage-'));
    const filePath = join(tmpDir, 'openclaw.jsonl');
    const scanner = new LeakageScanner();

    writeFileSync(filePath, JSON.stringify({
      type: 'message',
      id: 'msg_tool_result',
      sessionId: 'sess-openclaw',
      timestamp: '2026-02-18T05:01:31.752Z',
      message: {
        role: 'toolResult',
        toolCallId: 'tool_exec_1',
        toolName: 'exec',
        content: [
          {
            type: 'text',
            text: 'export GITHUB_TOKEN=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',
          },
        ],
      },
    }));

    const result = await scanner.scan([filePath]);
    expect(result.findings.some((f) => f.ruleId === 'S7')).toBe(true);

    const finding = result.findings.find((f) => f.ruleId === 'S7');
    expect(finding.sessionId).toBe('sess-openclaw');
    expect(finding.messageId).toBe('msg_tool_result');
    expect(finding.source).toBe('tool_output');
  });
});
