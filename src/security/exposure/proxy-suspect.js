import { execSync } from 'child_process';
import { networkInterfaces, platform } from 'os';

const PROXY_ENV_VARS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
];

const TUN_IFACE_PATTERN = /^(utun\d*|tun\d*|tap\d*|wg\d*|tailscale\d*|ppp\d*)$/i;

const PROXY_PROCESS_PATTERNS = [
  /clash/i,
  /clash-verge/i,
  /sing-box/i,
  /\bv2ray\b/i,
  /\bxray\b/i,
  /wireguard/i,
  /openvpn/i,
  /tailscale/i,
  /surge/i,
  /brook/i,
];

function detectProxyEnv() {
  const vars = PROXY_ENV_VARS.filter((name) => Boolean(process.env[name]));
  return {
    detected: vars.length > 0,
    vars,
  };
}

function detectTunInterfaces() {
  try {
    const ifaces = networkInterfaces();
    const names = Object.keys(ifaces || {}).filter((name) => TUN_IFACE_PATTERN.test(name));
    return {
      suspected: names.length > 0,
      names,
    };
  } catch {
    return { suspected: false, names: [] };
  }
}

function detectProxyProcesses() {
  try {
    const os = platform();
    let output = '';
    if (os === 'darwin' || os === 'linux') {
      output = execSync('ps aux', { timeout: 3000, encoding: 'utf-8' });
    } else if (os === 'win32') {
      output = execSync('tasklist /V /FO CSV', { timeout: 3000, encoding: 'utf-8' });
    } else {
      return { suspected: false, matches: [] };
    }

    const matches = [];
    for (const line of output.split('\n')) {
      if (!line) continue;
      if (/\bps aux\b/i.test(line) || /\btasklist\b/i.test(line) || /\bgrep\b/i.test(line)) continue;

      for (const pattern of PROXY_PROCESS_PATTERNS) {
        if (pattern.test(line)) {
          matches.push(pattern.source.replace(/\\b/g, ''));
          break;
        }
      }
    }

    const unique = [...new Set(matches)];
    return { suspected: unique.length > 0, matches: unique };
  } catch {
    return { suspected: false, matches: [] };
  }
}

/**
 * Heuristically detect whether traffic may be proxy/VPN-routed.
 * Conservative strategy: if uncertain, mark as suspected.
 */
export function detectProxySuspected() {
  const env = detectProxyEnv();
  const tun = detectTunInterfaces();
  const proc = detectProxyProcesses();

  const reasons = [];
  if (env.detected) reasons.push(`检测到代理环境变量: ${env.vars.join(', ')}`);
  if (tun.suspected) reasons.push(`检测到隧道网卡: ${tun.names.join(', ')}`);
  if (proc.suspected) reasons.push(`检测到代理/VPN进程特征: ${proc.matches.join(', ')}`);

  return {
    proxyDetected: env.detected,
    proxySuspected: env.detected || tun.suspected || proc.suspected,
    reasons,
  };
}

