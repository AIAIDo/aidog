import { PassThrough } from 'node:stream';
import { describe, it, expect, vi } from 'vitest';
import { CliAdapter } from '../../src/ai/adapters/cli.js';

function createMockChild() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();

  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');

  const handlers = {
    close: [],
    error: [],
  };

  return {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(),
    once(event, handler) {
      handlers[event].push(handler);
      return this;
    },
    emit(event, ...args) {
      if (event === 'close') {
        stdin.end();
        stdout.end();
        stderr.end();
      }
      for (const handler of handlers[event]) {
        handler(...args);
      }
    },
  };
}

describe('CliAdapter', () => {
  it('passes the prompt via argv and streams stdout chunks', async () => {
    const child = createMockChild();
    const spawnMock = vi.fn(() => child);
    const adapter = new CliAdapter({ spawn: spawnMock, timeoutMs: 1000 });
    adapter._detectAgent = vi.fn().mockResolvedValue({ name: 'claude', cmd: 'claude', args: (prompt) => ['-p', prompt] });

    const chunks = [];
    const resultPromise = adapter.analyze('system prompt', 'user prompt', {
      onChunk: (chunk) => chunks.push(chunk),
    });
    await Promise.resolve();

    child.stdout.write('{"summary":"ok"');
    child.stdout.write('}');
    child.emit('close', 0, null);

    const result = await resultPromise;

    expect(spawnMock).toHaveBeenCalledWith('claude', ['-p', 'system prompt\n\nuser prompt'], expect.objectContaining({
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    expect(chunks).toEqual(['{"summary":"ok"', '}']);
    expect(result).toBe('{"summary":"ok"}');
  });

  it('turns non-zero exits into CLI errors with stderr', async () => {
    const child = createMockChild();
    const adapter = new CliAdapter({ spawn: vi.fn(() => child), timeoutMs: 1000 });
    adapter._detectAgent = vi.fn().mockResolvedValue({ name: 'claude', cmd: 'claude', args: (prompt) => ['-p', prompt] });

    const resultPromise = adapter.analyze('system', 'user');
    await Promise.resolve();
    child.stderr.write('bad things happened');
    child.emit('close', 1, null);

    await expect(resultPromise).rejects.toThrow('claude CLI error: bad things happened');
  });

  it('turns timeouts into a clear timeout error', async () => {
    vi.useFakeTimers();
    const child = createMockChild();
    const adapter = new CliAdapter({ spawn: vi.fn(() => child), timeoutMs: 50 });
    adapter._detectAgent = vi.fn().mockResolvedValue({ name: 'claude', cmd: 'claude', args: (prompt) => ['-p', prompt] });

    const resultPromise = adapter.analyze('system', 'user');

    await vi.advanceTimersByTimeAsync(60);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    child.emit('close', null, 'SIGTERM');
    await expect(resultPromise).rejects.toThrow('claude CLI timed out after 0.05s');

    vi.useRealTimers();
  });

  it('passes large prompts via argv', async () => {
    const child = createMockChild();
    const spawnMock = vi.fn(() => child);
    const adapter = new CliAdapter({ spawn: spawnMock, timeoutMs: 1000 });
    adapter._detectAgent = vi.fn().mockResolvedValue({ name: 'codex', cmd: 'codex', args: (prompt) => ['exec', prompt] });

    const largePrompt = 'x'.repeat(200_000);
    const resultPromise = adapter.analyze('system', largePrompt);
    await Promise.resolve();

    child.stdout.write('done');
    child.emit('close', 0, null);

    const result = await resultPromise;

    expect(spawnMock).toHaveBeenCalledWith('codex', ['exec', `system\n\n${largePrompt}`], expect.any(Object));
    expect(result).toBe('done');
  });
});
