import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the parsing functions by importing the module and mocking execSync
describe('Local binding detection', () => {
  describe('parseLsofOutput (via scanLocalBindings)', () => {
    let scanLocalBindings, execSyncMock;

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
      execSyncMock.mockReturnValue(
        `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345 user   22u  IPv4 0x1234  0t0  TCP *:3000 (LISTEN)
redis    5678 user   6u  IPv4 0x5678  0t0  TCP *:6379 (LISTEN)
postgres 9999 user   5u  IPv4 0x9999  0t0  TCP 127.0.0.1:5432 (LISTEN)
`
      );

      const findings = await scanLocalBindings();
      const ports = findings.map(f => f.port);
      expect(ports).toContain(3000);
      expect(ports).toContain(6379);
      // 5432 bound to 127.0.0.1, should NOT appear
      expect(ports).not.toContain(5432);
    });

    it('should return empty for no 0.0.0.0 bindings', async () => {
      execSyncMock.mockReturnValue(
        `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345 user   22u  IPv4 0x1234  0t0  TCP 127.0.0.1:3000 (LISTEN)
`
      );

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
      execSyncMock.mockReturnValue(
        `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345 user   22u  IPv4 0x1234  0t0  TCP *:3000 (LISTEN)
`
      );

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
      execSyncMock.mockReturnValue(
        `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345 user   22u  IPv4 0x1234  0t0  TCP *:9999 (LISTEN)
node    12345 user   23u  IPv4 0x1235  0t0  TCP *:3000 (LISTEN)
`
      );

      const findings = await scanLocalBindings();
      // Port 9999 is not in DEFAULT_PORTS, should not appear
      expect(findings.map(f => f.port)).toEqual([3000]);
    });

    it('should detect 0.0.0.0:port format', async () => {
      execSyncMock.mockReturnValue(
        `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
mysql    1111 user   10u  IPv4 0x1111  0t0  TCP 0.0.0.0:3306 (LISTEN)
`
      );

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
