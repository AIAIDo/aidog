import net from 'net';
import { execSync } from 'child_process';

/**
 * Default ports and services to check.
 */
export const DEFAULT_PORTS = [
  { port: 22, service: 'SSH', severity: 'critical' },
  { port: 3306, service: 'MySQL', severity: 'critical' },
  { port: 5432, service: 'PostgreSQL', severity: 'critical' },
  { port: 6379, service: 'Redis', severity: 'critical' },
  { port: 27017, service: 'MongoDB', severity: 'critical' },
  { port: 8080, service: 'HTTP Proxy', severity: 'high' },
  { port: 8443, service: 'HTTPS Alt', severity: 'medium' },
  { port: 3000, service: 'Dev Server', severity: 'medium' },
  { port: 5000, service: 'Dev Server', severity: 'medium' },
];

/**
 * Probe a single port on a given IP.
 * @param {string} ip
 * @param {number} port
 * @param {number} [timeout=3000]
 * @returns {Promise<boolean>}
 */
export function probePort(ip, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port, timeout });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Scan multiple ports with concurrency limit.
 * @param {string} ip
 * @param {{ port: number, service: string, severity: string }[]} ports
 * @param {number} [timeout=3000]
 * @param {number} [concurrency=5]
 * @returns {Promise<import('../types.js').ExposureFinding[]>}
 */
export async function scanPorts(ip, ports, timeout = 3000, concurrency = 5) {
  const findings = [];
  const queue = [...ports];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const reachable = await probePort(ip, item.port, timeout);
      if (reachable) {
        findings.push({
          ruleId: `E_port_${item.port}`,
          ruleName: `${item.service} 端口暴露`,
          severity: item.severity,
          port: item.port,
          service: item.service,
          publicIp: ip,
          reachable: true,
          remediation: `关闭端口 ${item.port} 的公网访问或配置防火墙规则`,
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, ports.length) }, () => worker());
  await Promise.all(workers);

  return findings;
}

/**
 * Scan local ports bound to 0.0.0.0 (all interfaces) using OS commands.
 * @param {{ port: number, service: string, severity: string }[]} ports
 * @returns {Promise<import('../types.js').ExposureFinding[]>}
 */
export async function scanLocalBindings(ports = DEFAULT_PORTS) {
  const listeningPorts = getLocalListeningPorts();
  const findings = [];

  for (const item of ports) {
    const binding = listeningPorts.get(item.port);
    if (binding && binding.bindAll) {
      findings.push({
        ruleId: `E_local_bind_${item.port}`,
        ruleName: `${item.service} 本地全接口监听`,
        severity: item.severity,
        port: item.port,
        service: item.service,
        bindAddress: '0.0.0.0',
        pid: binding.pid || null,
        process: binding.process || null,
        reachable: false,
        remediation: `端口 ${item.port} 绑定在 0.0.0.0（所有接口），建议改为 127.0.0.1 仅本地访问`,
      });
    }
  }

  return findings;
}

/**
 * Get locally listening ports and their bind addresses via OS commands.
 * @returns {Map<number, { bindAll: boolean, pid: number|null, process: string|null }>}
 */
function getLocalListeningPorts() {
  /** @type {Map<number, { bindAll: boolean, pid: number|null, process: string|null }>} */
  const result = new Map();

  try {
    if (process.platform === 'win32') {
      // Windows: use netstat -ano
      const output = execSync('netstat -ano -p TCP', {
        encoding: 'utf-8',
        timeout: 10000,
      });
      parseWindowsNetstatOutput(output, result);
    } else if (process.platform === 'darwin') {
      // macOS: use lsof
      const output = execSync('lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null || true', {
        encoding: 'utf-8',
        timeout: 10000,
      });
      parseLsofOutput(output, result);
    } else {
      // Linux: try ss first, fallback to netstat
      try {
        const output = execSync('ss -tlnp 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 10000,
        });
        parseSsOutput(output, result);
      } catch {
        const output = execSync('netstat -tlnp 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 10000,
        });
        parseNetstatOutput(output, result);
      }
    }
  } catch {
    // If all commands fail, return empty map
  }

  return result;
}

/**
 * Parse lsof -iTCP -sTCP:LISTEN output.
 * Example line: node    1234 user   22u  IPv4 0x1234  0t0  TCP *:3000 (LISTEN)
 */
function parseLsofOutput(output, result) {
  for (const line of output.split('\n')) {
    // Match: TCP *:port or TCP 0.0.0.0:port
    const match = line.match(/^(\S+)\s+(\d+)\s+.*TCP\s+(?:\*|0\.0\.0\.0):(\d+)\s+\(LISTEN\)/);
    if (match) {
      const port = parseInt(match[3], 10);
      if (!result.has(port)) {
        result.set(port, {
          bindAll: true,
          pid: parseInt(match[2], 10) || null,
          process: match[1] || null,
        });
      }
    }
  }
}

/**
 * Parse ss -tlnp output.
 * Example line: LISTEN  0  128  0.0.0.0:3000  0.0.0.0:*  users:(("node",pid=1234,fd=22))
 */
function parseSsOutput(output, result) {
  for (const line of output.split('\n')) {
    if (!line.startsWith('LISTEN')) continue;
    const match = line.match(/(?:\*|0\.0\.0\.0):(\d+)/);
    if (match) {
      const port = parseInt(match[1], 10);
      const pidMatch = line.match(/pid=(\d+)/);
      const procMatch = line.match(/\("([^"]+)"/);
      if (!result.has(port)) {
        result.set(port, {
          bindAll: true,
          pid: pidMatch ? parseInt(pidMatch[1], 10) : null,
          process: procMatch ? procMatch[1] : null,
        });
      }
    }
  }
}

/**
 * Parse netstat -tlnp output.
 * Example line: tcp  0  0  0.0.0.0:3000  0.0.0.0:*  LISTEN  1234/node
 */
function parseNetstatOutput(output, result) {
  for (const line of output.split('\n')) {
    if (!line.includes('LISTEN')) continue;
    const match = line.match(/(?:\*|0\.0\.0\.0):(\d+)\s/);
    if (match) {
      const port = parseInt(match[1], 10);
      const pidMatch = line.match(/(\d+)\/(\S+)\s*$/);
      if (!result.has(port)) {
        result.set(port, {
          bindAll: true,
          pid: pidMatch ? parseInt(pidMatch[1], 10) : null,
          process: pidMatch ? pidMatch[2] : null,
        });
      }
    }
  }
}

/**
 * Parse Windows netstat -ano output.
 * Example line:   TCP    0.0.0.0:3306    0.0.0.0:0    LISTENING    1234
 */
function parseWindowsNetstatOutput(output, result) {
  for (const line of output.split('\n')) {
    if (!line.includes('LISTENING')) continue;
    const match = line.match(/TCP\s+0\.0\.0\.0:(\d+)\s+.*LISTENING\s+(\d+)/);
    if (match) {
      const port = parseInt(match[1], 10);
      if (!result.has(port)) {
        result.set(port, {
          bindAll: true,
          pid: parseInt(match[2], 10) || null,
          process: null, // Windows netstat doesn't show process name
        });
      }
    }
  }
}
