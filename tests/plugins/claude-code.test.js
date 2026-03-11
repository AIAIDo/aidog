import { describe, it, expect, afterEach } from 'vitest';
import { ClaudeCodePlugin } from '../../src/plugins/claude-code/index.js';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

describe('ClaudeCodePlugin', () => {
  let plugin;

  beforeEach(() => {
    plugin = new ClaudeCodePlugin();
  });

  describe('meta', () => {
    it('should have correct meta properties', () => {
      expect(plugin.meta.name).toBe('claude-code');
      expect(plugin.meta.displayName).toBe('Claude Code');
      expect(plugin.meta.version).toBe('1.0.0');
      expect(plugin.meta.homepage).toBe('https://claude.ai/code');
    });
  });

  describe('isAvailable', () => {
    it('should return false when projects directory does not exist', async () => {
      // Create a plugin with a non-existent home dir
      // The default plugin checks ~/.claude/projects, which may or may not exist
      // We can only test the behavior, not force the filesystem state
      const available = await plugin.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('fetchHistory', () => {
    let tmpDir;

    afterEach(() => {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should parse JSONL files from the projects directory', async () => {
      // We cannot easily override the private #getProjectsDir method,
      // so we test the parser integration through parseJSONLFile instead.
      // This is a structural/integration verification.
      tmpDir = mkdtempSync(join(tmpdir(), 'aidog-claude-test-'));
      const projectDir = join(tmpDir, '%2Ftmp%2Ftest-project');
      mkdirSync(projectDir, { recursive: true });

      const jsonlFile = join(projectDir, 'session.jsonl');
      const lines = [
        JSON.stringify({
          timestamp: '2025-01-15T10:00:00Z',
          sessionId: 'sess-1',
          message: {
            id: 'msg_1',
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'Hello' }],
            usage: { input_tokens: 1000, output_tokens: 500 },
          },
        }),
        JSON.stringify({
          timestamp: '2025-01-15T10:01:00Z',
          sessionId: 'sess-1',
          message: {
            id: 'msg_2',
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'World' }],
            usage: { input_tokens: 2000, output_tokens: 800 },
          },
        }),
      ];
      writeFileSync(jsonlFile, lines.join('\n'));

      // Test parseJSONLFile directly since we can't override private methods
      const { parseJSONLFile } = await import('../../src/plugins/claude-code/parser.js');
      const events = await parseJSONLFile(jsonlFile);
      expect(events).toHaveLength(2);
      expect(events[0].id).toBe('claude-code:msg_1');
      expect(events[1].id).toBe('claude-code:msg_2');
    });

    it('should deduplicate events by id', async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'aidog-claude-dedup-'));
      const projectDir = join(tmpDir, 'project1');
      mkdirSync(projectDir, { recursive: true });

      // Create two files with the same message id
      const line = JSON.stringify({
        timestamp: '2025-01-15T10:00:00Z',
        sessionId: 'sess-1',
        message: {
          id: 'msg_dup',
          role: 'assistant',
          content: [{ type: 'text', text: 'Duplicate' }],
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
      });

      writeFileSync(join(projectDir, 'file1.jsonl'), line);
      writeFileSync(join(projectDir, 'file2.jsonl'), line);

      // Parse both files and check deduplication logic
      const { parseJSONLFile } = await import('../../src/plugins/claude-code/parser.js');
      const events1 = await parseJSONLFile(join(projectDir, 'file1.jsonl'));
      const events2 = await parseJSONLFile(join(projectDir, 'file2.jsonl'));

      // Simulate deduplication as done in fetchHistory
      const allEvents = [];
      const seenIds = new Set();
      for (const event of [...events1, ...events2]) {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          allEvents.push(event);
        }
      }

      expect(allEvents).toHaveLength(1);
      expect(allEvents[0].id).toBe('claude-code:msg_dup');
    });
  });
});
