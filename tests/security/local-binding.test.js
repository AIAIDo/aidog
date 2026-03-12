import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the parsing functions by importing the module and mocking execSync
describe('Local binding detection', () => {
  describe('parseLsofOutput (via scanLocalBindings)', () => {
    let scanLocalBindings, execSyncMock;

    /**
     * Convert a list of port bindings into lsof-style output.
     * Each entry: { cmd, pid, addr, port }
     * addr = '*' means 0.0.0.0 (all interfaces), '127.0.0.1' means local-only.
     */
    function makeLsofOutput(bindings) {
      const header = 'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n';
      const lines = bindings.map(({ cmd, pid, addr, port }) =>
        `${cmd.padEnd(8)} ${pid} user   22u  IPv4 0x1234  0t0  TCP ${addr}:${port} (LISTEN)`
      );
      return header + lines.join('\n') + '\n';
    }

    /**
     * Convert the same bindings into ss -tlnp-style output (Linux).
     */
    function makeSsOutput(bindings) {
      const header = 'Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n';
      const lines = bindings.map(({ cmd, pid, addr, port }) => {
        const localAddr = addr === '*' ? '0.0.0.0' : addr;
        return `LISTEN 0 128 ${localAddr}:${port} 0.0.0.0:* users:(("${cmd}",pid=${pid},fd=22))`;
      });
      return header + lines.join('\n') + '\n';
    }

    /**
     * Convert the same bindings into netstat -tlnp-style output (Linux fallback).
     */
    function makeNetstatOutput(bindings) {
      const header = 'Proto Recv-Q Send-Q Local Address Foreign Address State PID/Program\n';
      const lines = bindings.map(({ cmd, pid, addr, port }) => {
        const localAddr = addr === '*' ? '0.0.0.0' : addr;
        return `tcp 0 0 ${localAddr}:${port} 0.0.0.0:* LISTEN ${pid}/${cmd}`;
      });
      return header + lines.join('\n') + '\n';
    }

    /**
     * Create a cross-platform execSync mock from a list of port bindings.
     * Returns the right output format based on which command is called.
     */
    function makeExecMock(bindings) {
      return vi.fn().mockImplementation((cmd) => {
        if (cmd.startsWith('lsof')) return makeLsofOutput(bindings);
        if (cmd.startsWith('ss')) return makeSsOutput(bindings);
        if (cmd.startsWith('netstat')) return makeNetstatOutput(bindings);
        return '';
      });
    }

    beforeEach(async () => {
      vi.resetModules();
      execSyncMock = vi.fn();
      vi.doMock('child_process', () => ({
        execSync: execSyncMock,
      }));
      const mod = await import('../../src/security/exposure/port-scanner.js');
      scanLocalBindings = mod.scanLocalBindings;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should detect 0.0.0.0 bindings from lsof output', async () => {
      execSyncMock.mockImplementation(makeExecMock([
        { cmd: 'node', pid: 12345, addr: '*', port: 3000 },
        { cmd: 'redis', pid: 5678, addr: '*', port: 6379 },
        { cmd: 'postgres', pid: 9999, addr: '127.0.0.1', port: 5432 },
      ]));

      const findings = await scanLocalBindings();
      const ports = findings.map(f => f.port);
      expect(ports).toContain(3000);
      expect(ports).toContain(6379);
      // 5432 bound to 127.0.0.1, should NOT appear
      expect(ports).not.toContain(5432);
    });

    it('should return empty for no 0.0.0.0 bindings', async () => {
      execSyncMock.mockImplementation(makeExecMock([
        { cmd: 'node', pid: 12345, addr: '127.0.0.1', port: 3000 },
      ]));

      const findings = await scanLocalBindings();
      expect(findings).toHaveLength(0);
    });

    it('should handle empty output', async () => {
      execSyncMock.mockReturnValue('');
      const findings = await scanLocalBindings();
      expect(findings).toHaveLength(0);
    });

    it('should handle command failure gracefully', async () => {
      execSyncMock.mockImplementation(() => { throw new Error('command not found'); });
      const findings = await scanLocalBindings();
      expect(findings).toHaveLength(0);
    });

    it('should include port, service, pid, process in findings', async () => {
      execSyncMock.mockImplementation(makeExecMock([
        { cmd: 'node', pid: 12345, addr: '*', port: 3000 },
      ]));

      const findings = await scanLocalBindings();
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        port: 3000,
        service: 'Dev Server',
        bindAddress: '0.0.0.0',
        pid: 12345,
        process: 'node',
        reachable: false,
        ruleId: 'E_local_bind_3000',
      });
    });

    it('should only report ports in the scan list', async () => {
      execSyncMock.mockImplementation(makeExecMock([
        { cmd: 'node', pid: 12345, addr: '*', port: 9999 },
        { cmd: 'node', pid: 12345, addr: '*', port: 3000 },
      ]));

      const findings = await scanLocalBindings();
      // Port 9999 is not in DEFAULT_PORTS, should not appear
      expect(findings.map(f => f.port)).toEqual([3000]);
    });

    it('should detect 0.0.0.0:port format', async () => {
      execSyncMock.mockImplementation(makeExecMock([
        { cmd: 'mysql', pid: 1111, addr: '0.0.0.0', port: 3306 },
      ]));

      const findings = await scanLocalBindings();
      expect(findings).toHaveLength(1);
      expect(findings[0].port).toBe(3306);
      expect(findings[0].service).toBe('MySQL');
    });
  });

  describe('scoring integration', () => {
    it('should deduct for local binding findings at 50% weight', async () => {
      const { SecurityEngine } = await import('../../src/security/index.js');
      const engine = new SecurityEngine();

      const exposureWithBinding = {
        portFindings: [],
        localBindingFindings: [
          { severity: 'critical', port: 3306, service: 'MySQL' },
        ],
        tunnelFindings: [],
      };

      const exposureWithoutBinding = {
        portFindings: [],
        tunnelFindings: [],
      };

      const scoreWith = engine.calculateSecurityScore(null, exposureWithBinding);
      const scoreWithout = engine.calculateSecurityScore(null, exposureWithoutBinding);

      expect(scoreWith.score).toBeLessThan(scoreWithout.score);
      expect(scoreWith.breakdown.exposure).toBeLessThan(50);
    });

    it('should deduct less for local binding than reachable port', async () => {
      const { SecurityEngine } = await import('../../src/security/index.js');
      const engine = new SecurityEngine();

      const withReachable = {
        portFindings: [{ severity: 'critical', reachable: true }],
        localBindingFindings: [],
        tunnelFindings: [],
      };

      const withBinding = {
        portFindings: [],
        localBindingFindings: [{ severity: 'critical' }],
        tunnelFindings: [],
      };

      const reachableScore = engine.calculateSecurityScore(null, withReachable);
      const bindingScore = engine.calculateSecurityScore(null, withBinding);

      // Local binding should penalize less than reachable port
      expect(bindingScore.score).toBeGreaterThan(reachableScore.score);
    });
  });
});
