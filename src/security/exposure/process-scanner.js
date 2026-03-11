import { execSync } from 'child_process';
import { platform } from 'os';

/**
 * Known tunneling tools to detect.
 */
const TUNNEL_TOOLS = [
  { name: 'ngrok', pattern: /ngrok/i },
  { name: 'frp', pattern: /frpc?(?:\s|$)/i },
  { name: 'cloudflared', pattern: /cloudflared/i },
  { name: 'openclaw', pattern: /openclaw/i },
  { name: 'bore', pattern: /\bbore\s/i },
  { name: 'localtunnel', pattern: /\blt\b.*--port/i },
];

/**
 * Mask sensitive arguments in process command lines.
 * @param {string} cmd
 * @returns {string}
 */
function maskSensitiveArgs(cmd) {
  return cmd
    .replace(/(--authtoken\s+)\S+/gi, '$1****')
    .replace(/(--token\s+)\S+/gi, '$1****')
    .replace(/(--auth\s+)\S+/gi, '$1****')
    .replace(/(--password\s+)\S+/gi, '$1****');
}

/**
 * Extract PID from a process line.
 * @param {string} line
 * @param {string} os
 * @returns {number}
 */
function extractPid(line, os) {
  if (os === 'win32') {
    // CSV format: "name","pid",...
    const parts = line.split(',');
    if (parts.length > 1) {
      const pid = parseInt(parts[1]?.replace(/"/g, ''));
      return isNaN(pid) ? 0 : pid;
    }
    return 0;
  }
  // Unix: USER PID %CPU %MEM ...
  const parts = line.trim().split(/\s+/);
  const pid = parseInt(parts[1]);
  return isNaN(pid) ? 0 : pid;
}

/**
 * Detect running tunneling tool processes.
 * @returns {import('../types.js').TunnelFinding[]}
 */
export function detectTunnels() {
  const os = platform();
  let output;

  try {
    if (os === 'darwin' || os === 'linux') {
      output = execSync('ps aux', { timeout: 5000, encoding: 'utf-8' });
    } else if (os === 'win32') {
      output = execSync('tasklist /V /FO CSV', { timeout: 5000, encoding: 'utf-8' });
    } else {
      return [];
    }
  } catch {
    return [];
  }

  const findings = [];
  const lines = output.split('\n');

  for (const line of lines) {
    for (const tool of TUNNEL_TOOLS) {
      if (tool.pattern.test(line)) {
        // Avoid matching the grep/ps command itself
        if (/\bgrep\b/.test(line) || /\bps\s/.test(line)) continue;

        findings.push({
          tool: tool.name,
          pid: extractPid(line, os),
          command: maskSensitiveArgs(line.trim().slice(0, 200)),
          severity: 'high',
        });
      }
    }
  }

  // Deduplicate by tool name + pid
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.tool}:${f.pid}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
